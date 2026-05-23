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
- [ ] Create the GitHub prerelease with clear source-only or unsigned-build notes.

## Binary Release

- [ ] Confirm Tauri bundling is enabled in `apps/desktop/src-tauri/tauri.conf.json`.
- [ ] Generate platform icons from original OpenGit artwork.
- [ ] Build unsigned artifacts locally with `npm run tauri:build`.
- [ ] On macOS, use `npm run tauri:build:mac-app` for the unsigned `.app` bundle until notarized DMG distribution is configured.
- [ ] Push a `v*` tag to run `.github/workflows/release.yml`.
- [ ] Review the generated draft GitHub release before publishing.
- [ ] Confirm updater artifacts and signatures are present when updater signing secrets are configured.
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

## Required GitHub Secrets

Updater artifact signing:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Platform signing and notarization are separate from updater signing and require Apple/Windows credentials before production binary distribution.
