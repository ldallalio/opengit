# Contributing To OpenGit

Thanks for taking the time to improve OpenGit.

OpenGit is currently an alpha project. The codebase is moving quickly, so small focused pull requests are easier to review than broad rewrites.

## Development Setup

Prerequisites:

- Node.js 22+
- npm 10+
- Rust stable toolchain
- Native `git`

Install dependencies:

```sh
npm install
```

Start the desktop app:

```sh
npm run tauri:dev
```

Run local verification before opening a pull request:

```sh
npm run check
```

## Pull Request Expectations

- Keep changes focused on one behavior or area.
- Include verification notes in the pull request body.
- Do not commit secrets, tokens, private repository paths, generated fixture repos, `node_modules`, build output, or local logs.
- Prefer existing UI and backend patterns over new abstractions.
- Add tests for parser, command-building, path-validation, credential-redaction, and Git-state changes when the behavior is risky.
- Keep user-facing copy original to OpenGit.

## Design And Legal Guardrails

OpenGit is inspired by the usefulness of graphical Git workflows, but it must remain an original product.

Do not contribute copied or closely recreated material from GitKraken or any other commercial Git client, including:

- screenshots
- icons
- product names
- proprietary UI text
- proprietary visual layouts
- artwork, fonts, or assets without a compatible license

When in doubt, describe the Git workflow you are trying to support and build an original OpenGit interaction for it.

## Security-Sensitive Changes

Changes touching credentials, Git command execution, path handling, provider authentication, update flows, or logging need extra care.

At minimum, verify:

- commands are invoked without a shell
- untrusted paths remain inside the selected repository or worktree
- tokens are stored only in OS keychain-backed storage
- logs and error messages redact secrets
- destructive Git operations require clear user intent

## Commit Messages

Use clear commit messages. Conventional commit prefixes such as `fix:`, `feat:`, `docs:`, `test:`, and `chore:` are welcome but not required.
