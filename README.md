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
npm install

# Run in development mode
npm run tauri tauri
```

## Building

```bash
# Build for production
npm run tauri build

# Build MSIX
pnpm run tauri:windows:build --arch "x64,arm64" --runner pnpm
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
pnpm run tauri dev
```

## System Tests (WebdriverIO + tauri-driver)

Run the system suite:

```bash
pnpm run test:system
```

By default, each run uses an isolated data folder and cleans it up when the suite finishes.

Prerequisites:

- Install `tauri-driver`: `cargo install tauri-driver --locked`
- On Windows, ensure `msedgedriver` is installed and version-matched to Edge

Useful env overrides:

- `TAURI_TEST_RUN_ID`: isolate each run's app data folder
- `TAURI_TEST_REUSE_RUN_ID=1`: reuse a fixed `TAURI_TEST_RUN_ID` across runs
- `TAURI_TEST_DATA_ROOT`: custom root folder for system-test data
- `TAURI_TEST_KEEP_DATA=1`: keep run data after test completion (no cleanup)
- `TAURI_DRIVER_PATH`: explicit path to `tauri-driver`
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
