# OpenGit

OpenGit is a local-first, cross-platform Git desktop client built with Tauri, React, TypeScript, and Rust.

It is an original open-source project for developers who want a polished Git GUI for everyday local repository work without a subscription. OpenGit is not affiliated with, endorsed by, or derived from GitKraken or any other commercial Git client.

> Status: alpha. OpenGit is usable for local workflows, but it is not production-stable yet and signed binary releases are not available.

## Releases

The first public alpha is published as a source-only prerelease:

- [OpenGit v0.1.0-alpha.1](https://github.com/ldallalio/opengit/releases/tag/v0.1.0-alpha.1)

Future `v*` tags run the Tauri release workflow and create draft prereleases with platform artifacts. Those artifacts are Tauri-updater-signed, but macOS notarization and Windows code signing still require developer signing credentials before they should be treated as end-user production installers.

## Features

- Open repositories with a native folder picker.
- Switch between recent repositories with top-level repo tabs.
- View branches, remotes, stashes, worktree status, and commit history.
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

## Platforms

OpenGit is designed for:

- macOS
- Windows
- Linux

Current development and day-to-day verification happen primarily on macOS. CI builds and tests the source on macOS, Windows, and Linux where possible, but signed installers are not published yet.

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

On macOS, if you only need the `.app` bundle while code signing/notarization is still pending, use:

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
