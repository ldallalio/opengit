# Signing And Updates

OpenGit uses Tauri updater signatures to authenticate update bundles. Platform code signing and macOS notarization are separate checks; a valid updater signature does not establish that an installer is code-signed or notarized.

## Tauri updater

The app checks GitHub Releases at:

```text
https://github.com/ldallalio/opengit/releases/latest/download/latest.json
```

The updater public key is committed in `apps/desktop/src-tauri/tauri.conf.json`. The private key must never be committed. The maintainer's documented local key location is `~/.opengit/opengit-updater.key`; verify its availability locally without exposing its contents.

Tagged release builds pass `src-tauri/tauri.release.conf.json`, which enables `createUpdaterArtifacts`. The workflow supplies:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Normal contributor builds use the default config and do not require the updater private key. Release builds require working signing configuration; inspect generated signatures and updater metadata before claiming updater delivery is verified.

## Current release flow

1. Prepare the intended release commit and update root/desktop package versions, npm lockfile, Rust package/lockfile and Tauri config together.
2. Run `npm run check`, review the diff and complete the prepublication checks in [Release checklist](release-checklist.md).
3. Push an annotated or signed `v*` tag pointing to that commit. The workflow triggers on any matching tag, regardless of its branch.
4. GitHub Actions builds macOS arm64, macOS x64, Linux x64 and Windows x64. Both macOS jobs explicitly bundle `.app` and `.dmg`; Linux/Windows use the configured default bundle targets. Tauri uploads binaries, updater artifacts and metadata into a draft release with `prerelease: false`.
5. The macOS jobs additionally notarize/staple DMG wrappers when Apple notarization credentials are configured, then replace those release assets.
6. After every build job succeeds, the publish job automatically makes the release public, ensures it is not a prerelease, and marks it latest. **There is no manual draft approval step.** Finish checks that require withholding publication before pushing the tag.
7. Verify the published asset set, `latest.json`, installer behavior and update from an earlier version. Record platform acceptance separately from a successful build.

## macOS signing and notarization

The workflow passes these optional repository secrets to Tauri:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

With the complete appropriate credentials, Tauri signs/notarizes the application. A separate workflow step submits each DMG with `xcrun notarytool`, staples it with `xcrun stapler`, and reuploads it using `gh release upload --clobber`.

When Apple credentials are absent, the workflow is designed to permit unsigned macOS builds; the DMG step explicitly skips when `APPLE_ID` is empty. Incomplete credentials can fail the build/notarization step. Verify actual signing and notarization output for each architecture before describing a release as signed or notarized.

## Windows and Linux

Windows binaries are currently unsigned at the platform level. The workflow does not configure a Windows certificate or Azure Trusted Signing; Tauri updater signatures do not remove Windows installer trust warnings.

Linux builds use Ubuntu 22.04 and install the required WebKitGTK/AppIndicator dependencies. The workflow does not include a separate package-signing or checksum-generation step. Inspect the uploaded bundle types and publish any additional checksums/signatures through the intended release process.
