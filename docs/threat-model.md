# OpenGit Threat Model

## Assets

- Git provider tokens.
- Local repository contents.
- Commit messages, branch names, remotes, file paths, and diffs.
- User filesystem paths.
- Release signing keys.

## Threats

### Malicious Repositories

Risks include unusual filenames, path traversal attempts, huge diffs, binary data, or hooks invoked by explicit Git operations.

Mitigations:

- Validate file paths before write operations.
- Use NUL-delimited status parsing where Git supports it.
- Do not run arbitrary scripts outside explicit Git commands.
- Stream or cap large diffs before rendering.

### Shell Injection

Risks include branch names, remote names, commit messages, and paths containing shell metacharacters.

Mitigations:

- Use `std::process::Command` with argument arrays.
- Never concatenate user input into shell strings.

### Credential Leakage

Risks include remote URLs with embedded tokens, logs, crash reports, telemetry, and plaintext local storage.

Mitigations:

- Redact remote URLs before rendering/logging.
- Store future provider credentials in OS keyrings only.
- Keep telemetry off by default and avoid repo names, paths, file contents, and commit text.

### Destructive Git Operations

Risks include hard resets, force pushes, branch deletes, and rebases.

Mitigations:

- MVP exposes only safer operations by default.
- Branch delete defaults to non-force delete.
- Push supports `--force-with-lease`, not raw force.
- Future destructive operations must create safety refs and require typed confirmation.

### Supply Chain And Updates

Risks include compromised dependencies or unsigned update artifacts.

Mitigations:

- Commit lockfiles.
- Run dependency audits before release.
- Use signed Tauri updater artifacts.
- Notarize macOS builds and code-sign Windows builds before public distribution.
