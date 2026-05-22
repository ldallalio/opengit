# Security Policy

OpenGit is alpha software. Please use it carefully on important repositories and review changes before running destructive Git operations.

## Supported Versions

Security fixes target the current `main` branch until the project has tagged stable releases.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| older commits | No |

## Reporting A Vulnerability

Please do not open public issues for vulnerabilities.

Use GitHub private vulnerability reporting if it is enabled on the repository. If it is not enabled yet, contact the repository maintainer privately and include:

- affected commit or release
- operating system
- steps to reproduce
- expected impact
- whether credentials, local files, or private repository data could be exposed

Do not include real tokens, private keys, private repository contents, or customer data in a report.

## Security Boundaries

OpenGit is designed around these boundaries:

- Native `git` is executed with argv arrays, not shell strings.
- Repository paths and file paths are treated as untrusted input.
- Credentials are stored in the operating system keychain.
- Tokens must not be written to localStorage, logs, crash reports, analytics, or remote URLs.
- Git hooks may run during explicit user Git operations, because native Git behavior is preserved.

## High-Risk Areas

Please flag changes in these areas for extra review:

- credential storage and provider authentication
- Git command construction and execution
- path canonicalization and file operations
- conflict resolution and destructive Git actions
- logging, telemetry, crash reporting, and error display
- updater, installer, signing, and release automation
