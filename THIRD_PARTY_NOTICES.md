# Third-Party Notices

This file tracks third-party dependencies and licensing considerations for OpenGit.

OpenGit is licensed under MIT. Third-party dependencies remain under their own licenses.

## Primary Runtime Dependencies

- Tauri v2 and Tauri plugins, including dialog and updater: MIT or Apache-2.0, depending on package.
- React and React DOM: MIT.
- Vite: MIT.
- TypeScript: Apache-2.0.
- lucide-react icons: ISC.
- clsx: MIT.
- Zustand: MIT.
- TanStack Query: MIT.
- Rust crates are governed by their package licenses in `Cargo.lock`.

## Git

OpenGit invokes the native `git` executable as a separate process. It does not link to Git as a library.

## Assets

All committed OpenGit UI assets should be original to this repository or explicitly compatible with the MIT-licensed project.

Do not commit copied icons, screenshots, artwork, fonts, copy, or visual assets from commercial Git clients.

## Before Binary Distribution

Before publishing signed installers or downloadable binaries:

- generate a complete dependency notice from `package-lock.json`
- generate a complete Rust dependency notice from `Cargo.lock`
- review all bundled assets and fonts
- include the generated notices with release artifacts where required
