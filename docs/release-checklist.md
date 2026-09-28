# Release Checklist

This checklist follows `.github/workflows/release.yml`. **Pushing a `v*` tag starts public release delivery:** the workflow builds a draft release, then automatically publishes it as a non-prerelease and marks it latest after all four platform builds succeed. There is no manual draft-review gate in the current workflow.

## Before tagging

- [ ] Confirm the exact release commit and preserve unrelated working-tree changes.
- [ ] Keep the application version consistent in root/desktop `package.json`, `package-lock.json`, `apps/desktop/src-tauri/Cargo.toml`, `Cargo.lock`, and `tauri.conf.json`.
- [ ] Run `npm ci`, `npm run check`, and `git diff --check`.
- [ ] Review `git status --short` and the release diff. Exclude generated build caches, local distribution folders, screenshots/logs containing private paths, credentials and signing keys.
- [ ] Update feature documentation and release notes; update `THIRD_PARTY_NOTICES.md` if dependencies changed.
- [ ] Verify worktree discovery and switching in the native app, and lifecycle safeguards in disposable repositories. Record native/platform acceptance gaps explicitly.
- [ ] Verify updater signing secrets are configured. Confirm which Apple signing/notarization credentials are available; do not infer signing success from secret names alone.
- [ ] Prepare release notes and finish checks that must precede public availability. The tag push is the publication trigger.

## Builds and publication

| Job | Artifacts/configuration |
| --- | --- |
| macOS arm64 | `aarch64-apple-darwin`, `.app` and `.dmg` bundles, updater artifacts |
| macOS x64 | `x86_64-apple-darwin`, `.app` and `.dmg` bundles, updater artifacts |
| Linux x64 | Ubuntu 22.04 runner, configured default Tauri bundles and updater artifacts |
| Windows x64 | Windows runner, configured default Tauri bundles and updater artifacts; binaries currently unsigned |

- [ ] For local verification, build with `npm run tauri:build`; `npm run tauri:build:mac-app` builds only the macOS app bundle. Local builds do not prove that CI signing/notarization succeeded.
- [ ] Commit the intended source/version/docs changes and create an annotated or signed `v*` tag from that commit.
- [ ] Push the release commit and tag to the intended repository.
- [ ] Monitor **all four** release jobs. Each uses `src-tauri/tauri.release.conf.json` to generate updater artifacts and uploads to a draft release.
- [ ] On macOS, inspect signing/notarization logs. The extra DMG step skips when `APPLE_ID` is empty; otherwise it submits, staples and replaces uploaded DMGs. Partial credentials can fail the job.
- [ ] Confirm the final Publish release job succeeded, the release is public/non-prerelease, and GitHub marks it latest. A failed matrix leaves automatic publication blocked; inspect any draft/assets before retrying.
- [ ] Inspect the actual uploaded assets, updater signatures and `latest.json` platform/version/URL entries. Test the updater against a prior installed version.
- [ ] Download and verify installers on clean macOS, Windows and Linux machines. Record unsigned Windows behavior and any unsigned/unnotarized macOS limitations in the release notes.
- [ ] Publish checksums if needed; the current workflow does not add a separate checksum-generation step.

## Security review

- [ ] Credential values remain in OS keychain storage; logs redact tokens and credential-bearing URLs.
- [ ] Git commands use argv arrays rather than shell interpolation.
- [ ] Destructive actions require explicit intent and retain native refusal safeguards.
- [ ] Release assets and diagnostics exclude private repository contents and credentials.

## Secrets

See [Signing and updates](signing-and-updates.md) for the exact updater and Apple secret names. Windows platform signing is not configured in the current release workflow. Tauri updater signatures are separate from platform code signing and notarization.
