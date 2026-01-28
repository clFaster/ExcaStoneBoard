# ExaStoneBoard

A multi-board manager for Excalidraw - manage multiple drawing boards without losing access to old ones.

## Features

- **Multiple Boards**: Create, rename, duplicate, and delete drawing boards
- **Auto-Save**: Your drawings are automatically saved locally
- **Collaboration Support**: Store collaboration room links with your boards
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Deep Linking**: Open Excalidraw collaboration links directly in the app (similar to Zoom)

## Prerequisites

Before building, ensure you have the following installed:

### Windows
1. **Rust**: Install from [rustup.rs](https://rustup.rs/)
2. **Node.js**: Version 18+ from [nodejs.org](https://nodejs.org/)
3. **WebView2**: Usually pre-installed on Windows 10/11. If not, download from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
4. **Visual Studio Build Tools**: Install "Desktop development with C++" workload from [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### macOS
1. **Rust**: Install from [rustup.rs](https://rustup.rs/)
2. **Node.js**: Version 18+ from [nodejs.org](https://nodejs.org/)
3. **Xcode Command Line Tools**: Run `xcode-select --install`

### Linux
1. **Rust**: Install from [rustup.rs](https://rustup.rs/)
2. **Node.js**: Version 18+ from [nodejs.org](https://nodejs.org/)
3. **System Dependencies**:
   ```bash
   # Ubuntu/Debian
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev
   
   # Fedora
   sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel
   ```

## Quick Start (Windows)

The project includes helper scripts that set up the Visual Studio environment automatically:

```bash
# Install dependencies first
npm install

# Run in development mode
dev.bat

# Or build for production
build.bat
```

## Development (Manual)

If you prefer to run commands manually or are on macOS/Linux:

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

**Note for Windows**: If you get linker errors running `npm run tauri dev` directly, use the `dev.bat` script instead, or run from "x64 Native Tools Command Prompt for VS".

## Building

```bash
# Build for production
npm run tauri build
```

Or on Windows, use `build.bat` which handles the Visual Studio environment setup.

The built application will be in `src-tauri/target/release/bundle/`.

## How It Works

1. **Board Management**: The app stores board metadata and data in your system's app data directory
2. **Excalidraw Integration**: Each board loads excalidraw.com in an embedded webview
3. **Data Storage**: Drawing data is extracted from the webview's localStorage and saved per-board
4. **Collaboration**: You can associate collaboration room links with boards for quick access
5. **Deep Links**: When you click a supported link, the app opens and prompts you to create a new board or use the current one

## Project Structure

```
ExaStoneBoard/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # React hooks
│   └── types/              # TypeScript types
├── src-tauri/              # Rust backend
│   ├── src/                # Rust source code
│   └── tauri.conf.json     # Tauri configuration
├── dev.bat                 # Windows dev script
├── build.bat               # Windows build script
└── README.md
```

## License

MIT
