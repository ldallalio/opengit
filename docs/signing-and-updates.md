# Signing And Updates

OpenGit has two separate signing concerns:

1. Tauri updater signing verifies that an update bundle came from the OpenGit release process.
2. Platform code signing verifies the app to macOS, Windows, and Linux package managers.

Updater signing is configured first. Platform signing still needs developer certificates before production installer distribution.

## Tauri Updater

The app is configured to check GitHub Releases for update metadata:

```text
https://github.com/ldallalio/opengit/releases/latest/download/latest.json
```

The updater public key is committed in `apps/desktop/src-tauri/tauri.conf.json`. The private key must never be committed.

Local private key location on the maintainer machine:

```text
~/.opengit/opengit-updater.key
```

GitHub Actions uses these repository secrets when creating updater artifacts:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Normal contributor builds do not require the private key. The release workflow passes `src-tauri/tauri.release.conf.json` to enable updater artifact generation only for tagged releases.

## Release Flow

1. Merge release-ready changes to `main`.
2. Update versions in `package.json`, `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, and `apps/desktop/src-tauri/tauri.conf.json`.
3. Run `npm run check`.
4. Create and push a signed or annotated `v*` tag.
5. Let `.github/workflows/release.yml` create a draft prerelease.
6. Download and test each generated artifact.
7. Publish only after the release notes clearly describe signing status and alpha limitations.

The current workflow builds macOS `.app` artifacts and updater archives. DMG packaging should be added after Apple Developer ID signing and notarization are configured.

## Platform Signing Still Needed

Before production installer distribution:

- macOS needs an Apple Developer ID certificate and notarization credentials.
- Windows needs a code-signing certificate or Azure Trusted Signing.
- Linux packages should publish checksums and, where possible, package signatures.

Do not enable automatic public installer publishing until platform signing and clean-machine installer tests are passing.
