# GitEx

Enhanced Git visualization and operations for VS Code — commit graph, blame, and diff — inspired by [GitExtensions](https://gitextensions.github.io/).

## Features

- **Commit Graph** — Interactive, canvas-rendered DAG with branch/tag badges, virtual scrolling, and an inline file-list pane
- **Blame** — Inline current-line annotations, gutter coloring by age or author, status-bar info, and rich hover details
- **Diff** — Native VS Code diff editor for comparing any two revisions or the working tree
- **Git Operations** — Checkout, branch, tag, merge, rebase, cherry-pick, reset, revert, and stash — all from the command palette or graph context

## Architecture

| Layer | Tech |
|---|---|
| Extension host | TypeScript / Node.js |
| Core algorithms | Rust compiled to WASM (`wasm-pack --target nodejs`) with a pure-TS fallback |
| Graph rendering | Webview with Canvas 2D |
| Git interface | `git` CLI via `child_process.spawn` |

## Getting Started

### Prerequisites

- VS Code **1.85+**
- Git installed and on your PATH
- Node.js 20+ and npm (for development)
- Rust toolchain + `wasm-pack` (optional, for WASM build)

### Development

```bash
# Install dependencies
npm install

# Build the extension (includes WASM if wasm-pack is available)
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Lint
npm run lint
```

Press **F5** in VS Code to launch the Extension Development Host.

### Building WASM Core (optional)

```bash
npm run build:wasm
```

If the WASM build is unavailable, the extension automatically falls back to a pure TypeScript implementation.

## Keyboard Shortcuts

| Shortcut | Command |
|---|---|
| `Ctrl+Shift+G G` | Open Git Graph |
| `Ctrl+Shift+G B` | Toggle File Blame |
| `Ctrl+Shift+G J` | Jump to Commit |

On macOS, use `Cmd` instead of `Ctrl`.

## Configuration

All settings are under the `gitex.*` namespace. Key options:

| Setting | Default | Description |
|---|---|---|
| `gitex.graph.defaultView` | `allBranches` | Show all branches or current branch only |
| `gitex.graph.showRemoteBranches` | `true` | Display remote tracking branches |
| `gitex.graph.showTags` | `true` | Display tags in the graph |
| `gitex.graph.showStashes` | `true` | Display stashes in the graph |
| `gitex.graph.rowHeight` | `24` | Row height in pixels |
| `gitex.graph.pageSize` | `500` | Commits fetched per page |
| `gitex.blame.inline.enabled` | `true` | Show inline blame on the current line |
| `gitex.blame.gutter.enabled` | `false` | Show blame in the gutter |
| `gitex.blame.gutter.colorMode` | `age` | Gutter coloring: `age` or `author` |

See the full list in **Settings > Extensions > GitEx**.

## License

[MIT](LICENSE)
