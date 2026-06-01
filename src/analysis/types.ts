export type LanguageId = 'javascript' | 'typescript' | 'python' | 'java';
export type RelationshipType = 'imports' | 'depends_on' | 'references';
export type NodeType = 'file' | 'dependency';

export interface AnalyzeOptions {
  maxFiles?: number;
  maxFileSizeBytes?: number;
  includeHidden?: boolean;
}

export interface ImportRecord {
  specifier: string;
  kind: 'relative' | 'project' | 'external' | 'package';
  resolvedPath?: string;
  dependencyName?: string;
}

export interface SymbolRecord {
  name: string;
  kind: 'class' | 'interface' | 'enum' | 'function' | 'type' | 'variable' | 'method' | 'package';
}

export interface FileRecord {
  id: string;
  relativePath: string;
  language: LanguageId;
  extension: string;
  size: number;
  lineCount: number;
  imports: ImportRecord[];
  declaredSymbols: SymbolRecord[];
  referencedTokens: string[];
}

export interface DependencyNode {
  id: string;
  name: string;
  importers: number;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  relativePath?: string;
  language?: LanguageId;
  size?: number;
  lineCount?: number;
  importCount?: number;
  symbolCount?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  weight: number;
  details: string[];
}

export interface ProjectStats {
  fileCount: number;
  dependencyCount: number;
  importEdgeCount: number;
  dependencyEdgeCount: number;
  referenceEdgeCount: number;
  languageCount: number;
  skippedFileCount: number;
  scannedBytes: number;
}

export interface ProjectReport {
  rootPath: string;
  generatedAt: string;
  files: FileRecord[];
  dependencies: DependencyNode[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: ProjectStats;
  skippedPaths: string[];
}
