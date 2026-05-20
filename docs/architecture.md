# OpenGit Architecture

## Stack

- Desktop shell: Tauri v2.
- UI: React, TypeScript, Vite.
- Backend: Rust command handlers.
- Git engine: native `git` CLI invoked without a shell.
- Shared contracts: TypeScript models in `packages/core`.
- UI primitives: `packages/ui`.

## Runtime Layers

1. React UI renders repository status, history, changes, branches, stashes, remotes, and operation logs.
2. TypeScript IPC wrapper calls Tauri commands and provides browser-demo fallbacks for design iteration.
3. Rust commands validate paths and execute native Git with argv arrays.
4. Git parsers normalize porcelain status, branches, remotes, stashes, history, diffs, and operation errors.
5. Future cache layer will persist repository registry and indexed read models in SQLite.
6. Future provider layer will add GitHub first behind provider adapter interfaces.

## Safety Rules

- Never spawn Git through a shell.
- Canonicalize repo roots with `git rev-parse --show-toplevel`.
- Reject absolute paths and parent-directory components for file operations.
- Redact credentials from remote URLs before returning data to the UI.
- Set `GIT_TERMINAL_PROMPT=0` so background commands do not hang waiting for credentials.
- Prefer `--force-with-lease` over force push.

## Current IPC Surface

- `repo_open(path)`
- `repo_clone(url, destination)`
- `repo_status(repo_path)`
- `git_stage(repo_path, paths)`
- `git_unstage(repo_path, paths)`
- `git_discard(repo_path, paths)`
- `git_commit(repo_path, message, amend)`
- `git_branch_create(repo_path, name, checkout)`
- `git_branch_checkout(repo_path, name)`
- `git_branch_delete(repo_path, name, force)`
- `git_fetch(repo_path, remote)`
- `git_pull(repo_path)`
- `git_push(repo_path, remote, branch, force_with_lease)`
- `git_stash_push(repo_path, message)`
- `git_stash_apply(repo_path, stash)`
- `git_stash_drop(repo_path, stash)`
- `git_diff(repo_path, path, staged)`

Every command returns a typed payload or a normalized backend error through Tauri's invoke boundary.
