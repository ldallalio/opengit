# Release Checklist

OpenGit can be shared as source before signed installers exist. Use this checklist before publishing downloadable binaries.

## Source Release

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] Review `git status --short`
- [ ] Confirm no secrets are tracked:
  - `.env`
  - API keys
  - provider tokens
  - private repository paths in screenshots or logs
- [ ] Update `README.md` feature/status notes.
- [ ] Update `THIRD_PARTY_NOTICES.md` if dependencies changed.
- [ ] Tag the release from a clean commit.

## Binary Release

- [ ] Enable Tauri bundling for the release branch.
- [ ] Generate platform icons from original OpenGit artwork.
- [ ] Build unsigned artifacts locally on each target platform.
- [ ] Configure macOS Developer ID signing.
- [ ] Notarize macOS builds.
- [ ] Configure Windows code signing.
- [ ] Sign Linux packages or publish checksums.
- [ ] Generate checksums for all artifacts.
- [ ] Verify installers on clean macOS, Windows, and Linux machines.
- [ ] Publish release notes that clearly mark alpha limitations.

## Security Review

- [ ] Confirm credential values are stored only in the OS keychain.
- [ ] Confirm logs redact tokens and credential-bearing URLs.
- [ ] Confirm Git commands use argv arrays and do not invoke shell strings.
- [ ] Confirm destructive Git operations require explicit user intent.
- [ ] Confirm generated crash/telemetry data does not include repo paths, commit messages, diffs, or file contents.
