# OpenGit

OpenGit is a local-first Git desktop client built as an original product, not a clone of any commercial Git GUI. The first vertical slice uses Tauri, React, TypeScript, and Rust to open local repositories, inspect status/history, stage files, and create commits through the native `git` CLI.

## Current MVP

- Open a local repository by path.
- Inspect branch, upstream, ahead/behind, remotes, stashes, file status, and recent commit history.
- Stage, unstage, and discard file changes with backend path validation.
- Create commits or amend the current commit.
- Run fetch, pull, push, branch, and stash actions through safe Rust command handlers.
- Use a dense, keyboard-friendly desktop layout with light and dark themes.

## Development

Prerequisites:

- Node.js 22+
- npm 10+
- Rust toolchain with Cargo
- native `git`

Commands:

```sh
npm install
npm run typecheck
npm run build
npm run tauri:dev
```

The browser-only Vite build includes demo data when it is not running inside Tauri. Real Git operations require the Tauri app runtime.

## Legal Guardrails

OpenGit must remain visually and legally distinct from GitKraken and other commercial Git clients. Do not copy product names, branding, iconography, screenshots, proprietary UI copy, artwork, layouts, or pixel-level design.
