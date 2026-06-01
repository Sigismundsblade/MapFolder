#!/usr/bin/env node
import path from 'node:path';
import { analyzeProject } from './analysis/projectAnalyzer';
import { startReportServer } from './report/server';

interface CliOptions {
  target: string;
  port: number;
  maxFiles: number;
  maxFileSize: number;
  includeHidden: boolean;
  open: boolean;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mapfolder failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const resolvedTarget = path.resolve(options.target);
  const report = await analyzeProject(resolvedTarget, {
    maxFiles: options.maxFiles,
    maxFileSizeBytes: options.maxFileSize,
    includeHidden: options.includeHidden,
  });

  const server = await startReportServer(report, {
    preferredPort: options.port,
    openBrowser: options.open,
  });

  console.log(`Analyzed ${report.stats.fileCount} files in ${resolvedTarget}.`);
  console.log(`Detected ${report.edges.length} relationships across ${report.stats.languageCount} languages.`);
  console.log(`Local report: ${server.url}`);
  console.log('The report stays on your machine and binds to 127.0.0.1 only.');
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = {
    target: '.',
    port: 4173,
    maxFiles: 2500,
    maxFileSize: 1024 * 1024,
    includeHidden: false,
    open: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '-h' || argument === '--help') {
      printHelp();
      process.exit(0);
    }

    if (argument === '-p' || argument === '--port') {
      options.port = readNumberOption(argument, args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === '--max-files') {
      options.maxFiles = readNumberOption(argument, args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === '--max-file-size') {
      options.maxFileSize = readNumberOption(argument, args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === '--include-hidden') {
      options.includeHidden = true;
      continue;
    }

    if (argument === '--no-open') {
      options.open = false;
      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }

    options.target = argument;
  }

  return options;
}

function readNumberOption(flag: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(`mapfolder

Usage:
  mapfolder [target] [options]

Options:
  -p, --port <port>            Preferred port for the local report server
      --max-files <count>      Maximum number of source files to scan
      --max-file-size <bytes>  Maximum size for a scanned source file
      --include-hidden         Include hidden files and hidden directories
      --no-open                Do not open the browser automatically
  -h, --help                   Show this help message`);
}
