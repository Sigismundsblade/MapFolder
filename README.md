# mapfolder

`mapfolder` is a local codebase relationship viewer. Point it at a folder and it opens a browser view showing how files connect through imports, dependencies, and cross-file references.

It currently supports:

- JavaScript
- TypeScript
- Python
- Java

The report is served from `127.0.0.1` only. Nothing is uploaded anywhere.

## What It Shows

- Project files
- Third-party dependencies
- File-to-file import edges
- File-to-package dependency edges
- Inferred reference links based on declared symbols

## Install

```bash
npm install
npm run build
npm link
```

## Usage

```bash
mapfolder ./project
```

Options:

```bash
mapfolder ./project --port 4300
mapfolder ./project --max-files 4000
mapfolder ./project --max-file-size 2097152
mapfolder ./project --include-hidden
mapfolder ./project --no-open
```

## Notes

- Large dependency folders and common build output directories are skipped by default.
- Binary files and oversized source files are skipped.
- Reference edges are heuristic. They are meant to help with exploration, not replace a language server or compiler.

## Local Development

```bash
npm install
npm run build
node dist/index.js . --no-open
```
