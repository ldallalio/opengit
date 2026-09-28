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

## Worktree lifecycle boundaries

Worktree management accepts only freshly registered targets. Destinations must be absolute, absent, have an existing canonical parent, and avoid every registered checkout and repository administrative directory. Arguments are passed separately to Git; option terminators and explicit ref namespaces prevent path/ref text from becoming command options. Existing worktree branches cannot be renamed/deleted or rewritten through restack from another checkout.

Removal is deliberately conservative: no force option, no directory-deletion fallback, no implicit branch deletion. Main/bare/locked/unavailable/dirty/conflicted/submodule/saved-lane checkouts are refused. Detached commits require a containing local branch or tag. Ignored content is separately acknowledged and the confirmation token changes with checkout identity/ref/HEAD or ignored file listing/metadata. This is a point-in-time safeguard, not a backup or a lock against external tools changing files between checks and Git execution.

Stale-registration cleanup is repository-wide and requires an explicit preview with identical expiry policy and candidate recheck. Missing paths are not automatically pruned. A lock prevents lifecycle changes but does not prevent edits or prove that a checkout is idle. Reveal/editor commands resolve registered directories and launch explicit system commands without shell interpolation.
