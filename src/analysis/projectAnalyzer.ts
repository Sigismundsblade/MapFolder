import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AnalyzeOptions,
  DependencyNode,
  FileRecord,
  GraphEdge,
  GraphNode,
  ImportRecord,
  LanguageId,
  ProjectReport,
  RelationshipType,
  SymbolRecord,
} from './types';

interface DiscoveredSource {
  absolutePath: string;
  relativePath: string;
  extension: string;
  language: LanguageId;
  content: string;
  size: number;
}

interface ParsedSource extends DiscoveredSource {
  lineCount: number;
  declaredSymbols: SymbolRecord[];
  referencedTokens: string[];
  rawImportSpecifiers: string[];
  pythonModuleName?: string;
  javaPackageName?: string;
}

interface ResolutionIndexes {
  jsPaths: Set<string>;
  pythonModules: Map<string, string>;
  javaTypes: Map<string, string>;
  javaPackages: Map<string, Set<string>>;
}

const SUPPORTED_EXTENSIONS = new Map<string, LanguageId>([
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.py', 'python'],
  ['.java', 'java'],
]);

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.turbo',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  'out',
  'bin',
  'obj',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.mvn',
]);

const COMMON_REFERENCE_TOKENS = new Set([
  'abstract',
  'arguments',
  'array',
  'async',
  'await',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'constructor',
  'continue',
  'default',
  'dict',
  'double',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'float',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'int',
  'interface',
  'java',
  'let',
  'list',
  'long',
  'module',
  'new',
  'none',
  'null',
  'number',
  'object',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'self',
  'static',
  'string',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'var',
  'void',
  'while',
]);

const JS_TS_IMPORT_PATTERN = /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"\n]+)['"]/g;
const JS_TS_REQUIRE_PATTERN = /require\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const JS_TS_DYNAMIC_IMPORT_PATTERN = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const PYTHON_IMPORT_PATTERN = /^\s*import\s+([A-Za-z0-9_.,\s]+)$/gm;
const PYTHON_FROM_PATTERN = /^\s*from\s+([A-Za-z0-9_.]+|\.+)\s+import\s+(.+)$/gm;
const JAVA_IMPORT_PATTERN = /^\s*import\s+([A-Za-z0-9_.*]+)\s*;$/gm;

export async function analyzeProject(rootPath: string, options: AnalyzeOptions = {}): Promise<ProjectReport> {
  const absoluteRoot = path.resolve(rootPath);
  const discovery = await discoverSourceFiles(absoluteRoot, options);
  const parsedSources = discovery.files.map(parseSourceFile);
  const indexes = buildResolutionIndexes(parsedSources);
  const files = parsedSources.map((source) => finalizeFileRecord(source, indexes));
  const dependencyMap = new Map<string, DependencyNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const fileIdByPath = new Map(files.map((file) => [file.relativePath, file.id]));
  const symbolIndex = buildSymbolIndex(files);

  for (const file of files) {
    for (const entry of file.imports) {
      if (entry.resolvedPath) {
        const targetId = fileIdByPath.get(entry.resolvedPath);
        if (targetId) {
          addEdge(edgeMap, file.id, targetId, 'imports', 1, [entry.specifier]);
        }
        continue;
      }

      const dependencyName = entry.dependencyName ?? topDependencyName(entry.specifier, file.language);
      if (!dependencyName) {
        continue;
      }

      const dependencyId = `dependency:${dependencyName}`;
      const existingDependency = dependencyMap.get(dependencyId);
      if (existingDependency) {
        existingDependency.importers += 1;
      } else {
        dependencyMap.set(dependencyId, {
          id: dependencyId,
          name: dependencyName,
          importers: 1,
        });
      }
      addEdge(edgeMap, file.id, dependencyId, 'depends_on', 1, [entry.specifier]);
    }
  }

  for (const file of files) {
    const matchesByTarget = new Map<string, Set<string>>();

    for (const token of file.referencedTokens) {
      const candidates = symbolIndex.get(token);
      if (!candidates || candidates.length === 0 || candidates.length > 4) {
        continue;
      }

      for (const candidate of candidates) {
        if (candidate.fileId === file.id) {
          continue;
        }

        const matchSet = matchesByTarget.get(candidate.fileId) ?? new Set<string>();
        matchSet.add(token);
        matchesByTarget.set(candidate.fileId, matchSet);
      }
    }

    for (const [targetId, matches] of matchesByTarget.entries()) {
      addEdge(edgeMap, file.id, targetId, 'references', matches.size, Array.from(matches).slice(0, 8));
    }
  }

  const dependencies = Array.from(dependencyMap.values()).sort((left, right) => left.name.localeCompare(right.name));
  const nodes: GraphNode[] = [
    ...files.map((file) => ({
      id: file.id,
      type: 'file' as const,
      label: path.basename(file.relativePath),
      relativePath: file.relativePath,
      language: file.language,
      size: file.size,
      lineCount: file.lineCount,
      importCount: file.imports.length,
      symbolCount: file.declaredSymbols.length,
    })),
    ...dependencies.map((dependency) => ({
      id: dependency.id,
      type: 'dependency' as const,
      label: dependency.name,
    })),
  ];

  const edges = Array.from(edgeMap.values()).sort((left, right) => left.id.localeCompare(right.id));
  const stats = {
    fileCount: files.length,
    dependencyCount: dependencies.length,
    importEdgeCount: edges.filter((edge) => edge.type === 'imports').length,
    dependencyEdgeCount: edges.filter((edge) => edge.type === 'depends_on').length,
    referenceEdgeCount: edges.filter((edge) => edge.type === 'references').length,
    languageCount: new Set(files.map((file) => file.language)).size,
    skippedFileCount: discovery.skippedPaths.length,
    scannedBytes: files.reduce((total, file) => total + file.size, 0),
  };

  return {
    rootPath: absoluteRoot,
    generatedAt: new Date().toISOString(),
    files,
    dependencies,
    nodes,
    edges,
    stats,
    skippedPaths: discovery.skippedPaths,
  };
}

async function discoverSourceFiles(rootPath: string, options: AnalyzeOptions): Promise<{ files: DiscoveredSource[]; skippedPaths: string[] }> {
  const maxFiles = options.maxFiles ?? 2500;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 1024 * 1024;
  const includeHidden = options.includeHidden ?? false;
  const files: DiscoveredSource[] = [];
  const skippedPaths: string[] = [];
  let limitReached = false;

  async function visitDirectory(directoryPath: string): Promise<void> {
    if (limitReached) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      skippedPaths.push(toPosix(path.relative(rootPath, directoryPath)) || '.');
      return;
    }

    for (const entry of entries) {
      if (limitReached) {
        break;
      }

      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = toPosix(path.relative(rootPath, entryPath));

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || (!includeHidden && entry.name.startsWith('.'))) {
          skippedPaths.push(relativePath);
          continue;
        }
        await visitDirectory(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!includeHidden && entry.name.startsWith('.')) {
        skippedPaths.push(relativePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      const language = SUPPORTED_EXTENSIONS.get(extension);
      if (!language) {
        continue;
      }

      const stats = await fs.stat(entryPath);
      if (stats.size > maxFileSizeBytes) {
        skippedPaths.push(relativePath);
        continue;
      }

      const content = await fs.readFile(entryPath, 'utf8');
      if (content.includes('\u0000')) {
        skippedPaths.push(relativePath);
        continue;
      }

      files.push({
        absolutePath: entryPath,
        relativePath,
        extension,
        language,
        content,
        size: stats.size,
      });

      if (files.length >= maxFiles) {
        limitReached = true;
        skippedPaths.push('[scan limit reached]');
      }
    }
  }

  await visitDirectory(rootPath);
  return { files, skippedPaths };
}

function parseSourceFile(source: DiscoveredSource): ParsedSource {
  const rawImportSpecifiers = extractImportSpecifiers(source.language, source.content);
  const declaredSymbols = extractDeclaredSymbols(source.language, source.content);
  const referencedTokens = extractReferenceTokens(source.language, source.content, declaredSymbols);
  const pythonModuleName = source.language === 'python' ? toPythonModuleName(source.relativePath) : undefined;
  const javaPackageName = source.language === 'java' ? extractJavaPackageName(source.content) : undefined;

  return {
    ...source,
    lineCount: countLines(source.content),
    declaredSymbols,
    referencedTokens,
    rawImportSpecifiers,
    pythonModuleName,
    javaPackageName,
  };
}

function buildResolutionIndexes(files: ParsedSource[]): ResolutionIndexes {
  const jsPaths = new Set<string>();
  const pythonModules = new Map<string, string>();
  const javaTypes = new Map<string, string>();
  const javaPackages = new Map<string, Set<string>>();

  for (const file of files) {
    jsPaths.add(file.relativePath);

    if (file.language === 'python' && file.pythonModuleName) {
      pythonModules.set(file.pythonModuleName, file.relativePath);
    }

    if (file.language === 'java') {
      const packageName = file.javaPackageName ?? '';
      if (!javaPackages.has(packageName)) {
        javaPackages.set(packageName, new Set<string>());
      }
      javaPackages.get(packageName)?.add(file.relativePath);

      for (const symbol of file.declaredSymbols) {
        if (!['class', 'interface', 'enum', 'type'].includes(symbol.kind)) {
          continue;
        }
        const qualifiedName = packageName ? `${packageName}.${symbol.name}` : symbol.name;
        javaTypes.set(qualifiedName, file.relativePath);
      }
    }
  }

  return {
    jsPaths,
    pythonModules,
    javaTypes,
    javaPackages,
  };
}

function finalizeFileRecord(source: ParsedSource, indexes: ResolutionIndexes): FileRecord {
  const imports = resolveImports(source, indexes);

  return {
    id: `file:${source.relativePath}`,
    relativePath: source.relativePath,
    language: source.language,
    extension: source.extension,
    size: source.size,
    lineCount: source.lineCount,
    imports,
    declaredSymbols: source.declaredSymbols,
    referencedTokens: source.referencedTokens,
  };
}

function resolveImports(source: ParsedSource, indexes: ResolutionIndexes): ImportRecord[] {
  const resolved: ImportRecord[] = [];

  for (const specifier of source.rawImportSpecifiers) {
    if (!specifier) {
      continue;
    }

    if (source.language === 'python') {
      resolved.push(...resolvePythonImports(source, specifier, indexes));
      continue;
    }

    if (source.language === 'java') {
      resolved.push(...resolveJavaImports(specifier, indexes));
      continue;
    }

    resolved.push(resolveJsTsImport(source, specifier, indexes));
  }

  return dedupeImports(resolved);
}

function resolveJsTsImport(source: ParsedSource, specifier: string, indexes: ResolutionIndexes): ImportRecord {
  if (specifier.startsWith('.')) {
    const fromDirectory = path.posix.dirname(source.relativePath);
    const candidate = resolveJsTsPath(fromDirectory, specifier, indexes.jsPaths);
    return {
      specifier,
      kind: candidate ? 'relative' : 'project',
      resolvedPath: candidate,
    };
  }

  return {
    specifier,
    kind: 'external',
    dependencyName: topDependencyName(specifier, source.language),
  };
}

function resolvePythonImports(source: ParsedSource, specifier: string, indexes: ResolutionIndexes): ImportRecord[] {
  const currentModule = source.pythonModuleName ?? '';
  const moduleName = normalizePythonImport(specifier, currentModule);

  if (moduleName) {
    const directMatch = indexes.pythonModules.get(moduleName);
    if (directMatch) {
      return [{ specifier, kind: 'project', resolvedPath: directMatch }];
    }

    const partialMatches = Array.from(indexes.pythonModules.entries())
      .filter(([modulePath]) => modulePath.startsWith(`${moduleName}.`))
      .slice(0, 6)
      .map(([, relativePath]) => ({
        specifier,
        kind: 'project' as const,
        resolvedPath: relativePath,
      }));

    if (partialMatches.length > 0) {
      return partialMatches;
    }
  }

  return [
    {
      specifier,
      kind: 'external',
      dependencyName: topDependencyName(moduleName || specifier, source.language),
    },
  ];
}

function resolveJavaImports(specifier: string, indexes: ResolutionIndexes): ImportRecord[] {
  if (specifier.endsWith('.*')) {
    const packageName = specifier.slice(0, -2);
    const packageMatches = Array.from(indexes.javaPackages.get(packageName) ?? []);
    if (packageMatches.length > 0) {
      return packageMatches.map((relativePath) => ({
        specifier,
        kind: 'package' as const,
        resolvedPath: relativePath,
      }));
    }
  }

  const directMatch = indexes.javaTypes.get(specifier);
  if (directMatch) {
    return [{ specifier, kind: 'project', resolvedPath: directMatch }];
  }

  return [
    {
      specifier,
      kind: 'external',
      dependencyName: topDependencyName(specifier, 'java'),
    },
  ];
}

function extractImportSpecifiers(language: LanguageId, content: string): string[] {
  const specifiers: string[] = [];

  if (language === 'javascript' || language === 'typescript') {
    collectMatches(JS_TS_IMPORT_PATTERN, content, specifiers);
    collectMatches(JS_TS_REQUIRE_PATTERN, content, specifiers);
    collectMatches(JS_TS_DYNAMIC_IMPORT_PATTERN, content, specifiers);
    return specifiers;
  }

  if (language === 'python') {
    let importMatch: RegExpExecArray | null;
    PYTHON_IMPORT_PATTERN.lastIndex = 0;
    while ((importMatch = PYTHON_IMPORT_PATTERN.exec(content)) !== null) {
      const modules = importMatch[1].split(',').map((value) => value.trim()).filter(Boolean);
      for (const moduleName of modules) {
        specifiers.push(moduleName.split(/\s+as\s+/i)[0]);
      }
    }

    let fromMatch: RegExpExecArray | null;
    PYTHON_FROM_PATTERN.lastIndex = 0;
    while ((fromMatch = PYTHON_FROM_PATTERN.exec(content)) !== null) {
      specifiers.push(fromMatch[1].trim());
    }

    return specifiers;
  }

  let javaMatch: RegExpExecArray | null;
  JAVA_IMPORT_PATTERN.lastIndex = 0;
  while ((javaMatch = JAVA_IMPORT_PATTERN.exec(content)) !== null) {
    specifiers.push(javaMatch[1].trim());
  }

  return specifiers;
}

function extractDeclaredSymbols(language: LanguageId, content: string): SymbolRecord[] {
  const declarations: SymbolRecord[] = [];
  const seen = new Set<string>();
  const addSymbol = (name: string, kind: SymbolRecord['kind']) => {
    const key = `${kind}:${name}`;
    if (!name || seen.has(key)) {
      return;
    }
    seen.add(key);
    declarations.push({ name, kind });
  };

  if (language === 'javascript' || language === 'typescript') {
    const topLevelPattern = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|interface|enum|type|function)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let match: RegExpExecArray | null;
    while ((match = topLevelPattern.exec(content)) !== null) {
      addSymbol(match[2], match[1] as SymbolRecord['kind']);
    }

    const variablePattern = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    while ((match = variablePattern.exec(content)) !== null) {
      addSymbol(match[1], 'variable');
    }

    return declarations;
  }

  if (language === 'python') {
    const classPattern = /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    const functionPattern = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    let match: RegExpExecArray | null;
    while ((match = classPattern.exec(content)) !== null) {
      addSymbol(match[1], 'class');
    }
    while ((match = functionPattern.exec(content)) !== null) {
      addSymbol(match[1], 'function');
    }
    return declarations;
  }

  const packagePattern = /^\s*package\s+([A-Za-z0-9_.]+)\s*;/gm;
  const typePattern = /(?:^|\n)\s*(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+)*(class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const methodPattern = /(?:^|\n)\s*(?:public|protected|private)\s+(?:static\s+)?[A-Za-z0-9_<>\[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = packagePattern.exec(content)) !== null) {
    addSymbol(match[1], 'package');
  }
  while ((match = typePattern.exec(content)) !== null) {
    addSymbol(match[2], match[1] === 'record' ? 'type' : (match[1] as SymbolRecord['kind']));
  }
  while ((match = methodPattern.exec(content)) !== null) {
    addSymbol(match[1], 'method');
  }
  return declarations;
}

function extractReferenceTokens(language: LanguageId, content: string, declaredSymbols: SymbolRecord[]): string[] {
  const cleaned = stripNoise(language, content);
  const tokens = cleaned.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  const localSymbols = new Set(declaredSymbols.map((symbol) => symbol.name));
  const uniqueTokens = new Set<string>();

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    if (COMMON_REFERENCE_TOKENS.has(lowerToken) || localSymbols.has(token)) {
      continue;
    }
    uniqueTokens.add(token);
  }

  return Array.from(uniqueTokens).sort();
}

function stripNoise(language: LanguageId, content: string): string {
  if (language === 'python') {
    return content
      .replace(/'''[\s\S]*?'''/g, ' ')
      .replace(/"""[\s\S]*?"""/g, ' ')
      .replace(/#[^\n]*/g, ' ')
      .replace(/'(?:\\.|[^'\\])*'/g, ' ')
      .replace(/"(?:\\.|[^"\\])*"/g, ' ');
  }

  return content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ');
}

function buildSymbolIndex(files: FileRecord[]): Map<string, Array<{ fileId: string; filePath: string }>> {
  const index = new Map<string, Array<{ fileId: string; filePath: string }>>();

  for (const file of files) {
    for (const symbol of file.declaredSymbols) {
      if (!shouldIndexSymbol(symbol)) {
        continue;
      }
      const bucket = index.get(symbol.name) ?? [];
      bucket.push({ fileId: file.id, filePath: file.relativePath });
      index.set(symbol.name, bucket);
    }
  }

  return index;
}

function shouldIndexSymbol(symbol: SymbolRecord): boolean {
  if (symbol.name.length < 3) {
    return false;
  }

  if (COMMON_REFERENCE_TOKENS.has(symbol.name.toLowerCase())) {
    return false;
  }

  return ['class', 'interface', 'enum', 'function', 'type'].includes(symbol.kind);
}

function addEdge(
  edgeMap: Map<string, GraphEdge>,
  source: string,
  target: string,
  type: RelationshipType,
  weight: number,
  details: string[],
): void {
  if (source === target) {
    return;
  }

  const key = `${type}:${source}:${target}`;
  const existing = edgeMap.get(key);
  if (existing) {
    existing.weight += weight;
    existing.details = Array.from(new Set([...existing.details, ...details])).slice(0, 8);
    return;
  }

  edgeMap.set(key, {
    id: key,
    source,
    target,
    type,
    weight,
    details: Array.from(new Set(details)).slice(0, 8),
  });
}

function resolveJsTsPath(fromDirectory: string, specifier: string, knownPaths: Set<string>): string | undefined {
  const basePath = path.posix.normalize(path.posix.join(fromDirectory, specifier));
  const extension = path.posix.extname(basePath);
  const candidates = extension
    ? [basePath]
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        `${basePath}.mjs`,
        `${basePath}.cjs`,
        path.posix.join(basePath, 'index.ts'),
        path.posix.join(basePath, 'index.tsx'),
        path.posix.join(basePath, 'index.js'),
        path.posix.join(basePath, 'index.jsx'),
      ];

  return candidates.find((candidate) => knownPaths.has(candidate));
}

function normalizePythonImport(specifier: string, currentModule: string): string {
  if (!specifier.startsWith('.')) {
    return specifier;
  }

  const dotCount = specifier.match(/^\.+/)?.[0].length ?? 0;
  const remainder = specifier.slice(dotCount);
  const packageParts = currentModule.split('.').slice(0, -1);
  const retainedParts = dotCount > 0 ? packageParts.slice(0, Math.max(0, packageParts.length - (dotCount - 1))) : packageParts;
  const remainderParts = remainder ? remainder.split('.') : [];

  return [...retainedParts, ...remainderParts].filter(Boolean).join('.');
}

function extractJavaPackageName(content: string): string | undefined {
  const match = content.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/m);
  return match?.[1];
}

function toPythonModuleName(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.py$/, '');
  const parts = withoutExtension.split('/');
  if (parts[parts.length - 1] === '__init__') {
    parts.pop();
  }
  return parts.join('.');
}

function topDependencyName(specifier: string, language: LanguageId): string {
  if (language === 'python') {
    return specifier.split('.')[0] || specifier;
  }

  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return name ? `${scope}/${name}` : scope;
  }

  return specifier.split(/[./]/)[0] || specifier;
}

function dedupeImports(imports: ImportRecord[]): ImportRecord[] {
  const seen = new Set<string>();
  return imports.filter((entry) => {
    const key = `${entry.specifier}:${entry.kind}:${entry.resolvedPath ?? entry.dependencyName ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectMatches(pattern: RegExp, content: string, results: string[]): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    results.push(match[1].trim());
  }
}

function countLines(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}
