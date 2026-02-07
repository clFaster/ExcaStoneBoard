# ExcaStoneBoard

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