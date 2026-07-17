# ExcaStoneBoard <img src="src-tauri/icons/128x128.png" alt="ExcaStoneBoard Logo" width="30" height="30" style="vertical-align: middle;"/>

<div align="center">

[![Download from Microsoft Store](https://img.shields.io/endpoint?url=https%3A%2F%2Fmicrosoft-store-badge.fly.dev%2Fapi%2Frating%3FstoreId%3D9N95C6FV59Z7%26market%3DUS&style=for-the-badge&label=Download+from+Microsoft+Store&color=brightgreen&logo=windows11)](https://www.microsoft.com/store/productId/9N95C6FV59Z7)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

</div>

An unofficial multi-board manager for Excalidraw - manage multiple drawing boards without losing access to old ones.

## Features

- **Multiple Boards**: Create, rename, duplicate, and delete drawing boards
- **Auto-Save**: Your drawings are automatically saved locally
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Prerequisites

Before building, ensure you have the following installed:

### Windows

1. **Rust**: Install from [rustup.rs](https://rustup.rs/)
2. **Node.js**: Version 24+ from [nodejs.org](https://nodejs.org/)
3. **Visual Studio Build Tools**: Install "Desktop development with C++" workload from [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

## Quick Start

The project includes helper scripts that set up the Visual Studio environment automatically:

```bash
# Install dependencies first
pnpm install

# Run in development mode
pnpm tauri dev
```

## Building

```bash
# Build for production
pnpm tauri build

# Build MSIX
pnpm tauri:windows:build --arch "x64,arm64" --runner pnpm
```

## System Test Mode

For deterministic system-test runs, you can enable test mode:

- `TAURI_TEST_MODE=1` enables deterministic import/export paths and test data isolation.
- `TAURI_TEST_RUN_ID` (optional) isolates each run into its own data subdirectory.
- `TAURI_TEST_EXPORT_PATH` and `TAURI_TEST_IMPORT_PATH` (optional) override deterministic file paths.

Windows PowerShell example:

```powershell
$env:TAURI_TEST_MODE = "1"
$env:TAURI_TEST_RUN_ID = "local-smoke"
pnpm tauri dev
```

## System Tests (WebdriverIO + tauri-driver)

The system tests live in a self-contained project under [`e2e/`](e2e/) with their
own `package.json` and lockfile, following the
[official Tauri WebDriver example](https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/).

Run the system suite from the repository root:

```bash
pnpm test:system
```

This installs the `e2e` dependencies (if needed) and runs the suite. You can
also run it directly inside the project:

```bash
pnpm --dir e2e install
pnpm --dir e2e test
```

The WebdriverIO config builds the Tauri debug binary automatically
(`tauri build --debug --no-bundle`) before starting the tests, and by default
each run uses an isolated data folder that is cleaned up when the suite
finishes.

Prerequisites:

- Install `tauri-driver`: `cargo install tauri-driver --locked`
- On Windows, ensure a matching `msedgedriver` is on `PATH` (in CI this is
  installed via [`msedgedriver-tool`](https://github.com/chippers/msedgedriver-tool))
- On Linux, install `webkit2gtk-driver` and run under `xvfb` (see the CI workflow)

Useful env overrides:

- `TAURI_TEST_RUN_ID`: isolate each run's app data folder
- `TAURI_TEST_DATA_ROOT`: custom root folder for system-test data
- `TAURI_TEST_KEEP_DATA=1`: keep run data after test completion (no cleanup)
- `TAURI_TEST_EXPORT_PATH` / `TAURI_TEST_IMPORT_PATH`: deterministic transfer file paths

Current automated scenarios (`e2e/specs/system.e2e.mjs`):

- Smoke flow (create board + open/close settings)
- Board lifecycle (create, rename, duplicate)
- Board persistence across app restart (`browser.reloadSession`)
- Settings persistence across app restart (`browser.reloadSession`)

## How It Works

**Board Management**: The app stores board metadata and data in your system's app data directory

## Project Structure

```
ExcaStoneBoard/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # React hooks
│   └── types/              # TypeScript types
├── src-tauri/              # Rust backend
│   ├── src/                # Rust source code
│   └── tauri.conf.json     # Tauri configuration
└── README.md
```

## License

[MIT](LICENSE)
