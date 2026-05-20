# Third-Party Notices

This file tracks third-party dependencies and licensing considerations as OpenGit evolves.

Initial implementation:

- Tauri v2: MIT or Apache-2.0, depending on package.
- React: MIT.
- Vite: MIT.
- TypeScript: Apache-2.0.
- Rust crates are governed by their package licenses.
- OpenGit invokes the native `git` executable as a separate process and does not link to Git.

Before distribution, generate a complete dependency notice from `package-lock.json` and `Cargo.lock`, then review all UI assets, fonts, and icons for license compatibility.
