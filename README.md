# mapfolder

`mapfolder` is a local project mapper for codebases that are hard to untangle by hand. Point it at a folder and it scans the source tree, builds a relationship graph, and opens a browser report that shows how files connect through imports, package dependencies, and likely cross-file references.

This is meant for the moment where you inherit a repo, open a few folders, and still cannot tell what talks to what. Instead of reading file after file in sequence, `mapfolder` gives you a structural view of the project so you can spot entry points, shared modules, dependency-heavy files, and clusters of related code much faster.

## What It Does

For a supported codebase, `mapfolder`:

- walks the project folder recursively
- finds supported source files
- extracts import statements
- resolves local file-to-file relationships where possible
- separates third-party packages into their own dependency nodes
- infers additional reference links from declared symbols and token usage
- serves an interactive browser report on `127.0.0.1`

The browser report is not just a static diagram. It gives you:

- a relationship map of files and dependencies
- language filters
- relationship filters
- search
- a file list ordered for browsing
- a details pane showing imports, symbols, and related connections

## Supported Languages

- JavaScript: `.js`, `.jsx`, `.mjs`, `.cjs`
- TypeScript: `.ts`, `.tsx`
- Python: `.py`
- Java: `.java`

More languages can be added over time as the analyzer grows.

## Why It Is Useful

This is most helpful when you need to:

- understand an unfamiliar project quickly
- trace how one file or module connects to others
- inspect dependency-heavy areas of a codebase
- get a rough mental map before refactoring
- explore an older repository without setting up a full IDE index first

## How It Works

`mapfolder` reads source files locally and builds a report in memory. It does not upload project contents anywhere. The report server binds to `127.0.0.1` only, so the browser view stays on your machine.

The relationship model includes:

- file nodes for project source files
- dependency nodes for external packages or imported modules
- import edges between project files
- dependency edges from files to external packages
- inferred reference edges based on symbol matching

Reference edges are heuristic by design. They help surface likely connections, but they are not a replacement for a compiler, language server, or full semantic indexer.

## Install

```bash
npm install
npm run build
npm link
```

After linking, the CLI is available as `mapfolder`.

## Usage

Analyze the current directory:

```bash
mapfolder .
```

Analyze a specific project:

```bash
mapfolder "C:\projects\my-app"
```

Useful options:

```bash
mapfolder ./project --port 4300
mapfolder ./project --max-files 4000
mapfolder ./project --max-file-size 2097152
mapfolder ./project --include-hidden
mapfolder ./project --no-open
```

## Safety And Scan Defaults

By default, `mapfolder` skips common directories that are large, generated, or not useful for source analysis, including things like:

- `.git`
- `node_modules`
- `dist`
- `build`
- `coverage`
- `.venv`
- `venv`
- `target`
- `__pycache__`

It also skips:

- files over the configured size limit
- binary-like files
- unsupported extensions

If a target folder contains no supported files, the CLI now exits with a clear error instead of silently opening an empty view.

## Local Development

```bash
npm install
npm run build
node dist/index.js . --no-open
```
