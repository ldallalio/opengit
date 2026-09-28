# OpenGit

OpenGit is a local-first, cross-platform Git desktop client built with Tauri,
React, TypeScript, and Rust. Commit graph, hunk/line-level staging,
side-by-side diffs, a merge conflict resolver, safety snapshots before
destructive operations, and first-class Azure DevOps support alongside
GitHub and GitLab.

Works fully offline. No telemetry, no account, no subscription.

OpenGit is not affiliated with, endorsed by, or derived from GitKraken or any other commercial Git client.

## Download

- **[Official builds](https://opengit-site.vercel.app)** — macOS, Windows, and Linux. See each release for signing status; Windows binaries are currently unsigned. Pay once ($15), updates are free forever.
- **Build from source** — the code is MIT licensed and free for anyone; see [Development](#development) below. Linux builds are always free either way.
- **[Latest GitHub release](https://github.com/ldallalio/opengit/releases/latest)** — raw installers if you'd rather not go through the site.

## Support the project

If you're building from source and want to chip in anyway: [donate](https://donate.stripe.com/3cIeVebJCf1p40s6rN93y01).

## Features

- Open repositories with a native folder picker.
- Switch between recent repositories with top-level repo tabs.
- View branches, remotes, stashes, worktree status, and commit history.
- Discover and manage every registered worktree, with checkout-specific drafts and guarded lifecycle actions.
- Render a capped linked commit graph across branches.
- Filter history by commit type, author, and date order.
- Stage, unstage, stage all, unstage all, and discard file changes.
- Commit, amend the HEAD commit message, and generate commit messages with an optional OpenAI API key.
- Fetch, pull, push, force-with-lease, create branches, checkout branches, delete branches, rename branches, merge, rebase, cherry-pick, revert, and tag.
- Detect non-fast-forward push failures and offer recovery actions.
- Resolve merge/rebase/cherry-pick conflicts with current, incoming, and result panes.
- Review commit file lists and side-by-side diffs.
- Store OpenAI API keys and Azure DevOps PATs in the operating system keychain.
- Use Azure DevOps HTTPS remotes without embedding tokens in remote URLs.

## Worktrees

Open any checkout to see every registered worktree in the sidebar. **Manage** opens the searchable worktree manager; the command palette also includes **Manage Worktrees**. A branch checked out elsewhere opens its existing checkout, and branch/commit menus can create a worktree from the selected source.

The manager supports new/existing branches and detached commits, folder selection, reveal/editor actions, locks, move, locate/repair, clean removal, and previewed stale-registration cleanup. Remote bases create tracking branches. Each checkout keeps its own commit draft, amend setting and view selections while open in the app. Closing a tab does not remove a checkout.

Removal preserves the branch and refuses dirty, locked, main, conflicted, submodule, saved-lane and unreferenced detached checkouts. Ignored files require acknowledgement and the preview is rechecked before removal. Checkout-local undo history is removed with a checkout; it is not a complete backup. There is no force removal. Missing directories may be disconnected drives: locate/repair or lock them before considering repository-wide cleanup.


## Platforms

OpenGit is designed for:

- macOS
- Windows
- Linux

Current development and day-to-day verification happen primarily on macOS. CI checks the source on macOS, Windows, and Linux. Tagged releases build macOS arm64 and x64 (app and DMG), Windows x64, and Linux x64, with Tauri updater signatures. macOS code signing/notarization depends on the configured Apple credentials; Windows binaries are currently unsigned. Download current installers from [GitHub Releases](https://github.com/ldallalio/opengit/releases/latest), and check their release notes for verified signing and platform acceptance.

The release workflow automatically publishes and marks a release latest after all four builds succeed. See the [release checklist](docs/release-checklist.md) and [signing/update guide](docs/signing-and-updates.md) before pushing a release tag.

## Screenshots

Screenshots are intentionally not committed yet. Add original OpenGit screenshots only; do not use reference screenshots from commercial Git clients.

## Requirements

- Node.js 22+
- npm 10+
- Rust stable toolchain with Cargo
- Native `git` available on `PATH`

Linux development also needs the native Tauri/WebKit build dependencies for your distribution.

## Development

Install dependencies:

```sh
npm install
```

Run the desktop app:

```sh
npm run tauri:dev
```

Build the local desktop bundle:

```sh
npm run tauri:build
```

On macOS, build only the local `.app` bundle without the DMG packaging step with:

```sh
npm run tauri:build:mac-app
```

Run the browser preview with demo data:

```sh
npm --workspace apps/desktop run dev
```

Run checks:

```sh
npm run typecheck
npm run build
npm run test
```

Run the full local check used before opening pull requests:

```sh
npm run check
```

## Project Layout

```text
apps/desktop/          React/Vite frontend and Tauri Rust backend
packages/core/         Shared TypeScript domain models
packages/ui/           Shared React UI primitives
docs/                  Architecture, product, and threat-model notes
assets/                Original OpenGit assets
```

## Security Model

- Git commands are executed through argv arrays, not shell strings.
- Repository paths are canonicalized before Git operations.
- File operations validate repository-relative paths.
- Credentials are stored in the OS keychain:
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service-compatible keyring
- Tokens are not stored in localStorage or remote URLs.
- Logs and error messages are redacted before display.

Read [SECURITY.md](SECURITY.md) before reporting vulnerabilities.

## Legal And Design Guardrails

OpenGit must remain visually and legally distinct from GitKraken and other commercial Git clients.

Do not copy:

- product names or branding
- proprietary icons, screenshots, artwork, or marketing copy
- pixel-perfect layouts
- proprietary UI text
- bundled commercial assets

It is fine to implement standard Git concepts and common developer workflows, but the interaction design, visual language, assets, and copy must remain original to OpenGit.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

OpenGit is released under the [MIT License](LICENSE).

Third-party dependency notes are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
