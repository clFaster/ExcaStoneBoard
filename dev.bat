@echo off
REM DrawMeSomething Development Script
REM This script sets up the Visual Studio environment and starts the dev server

echo DrawMeSomething Dev Helper
echo ==========================
echo.

REM Check for Visual Studio installations using vswhere
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"

if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -property installationPath`) do set "VS_PATH=%%i"
)

if defined VS_PATH (
    echo Found Visual Studio at: %VS_PATH%
    echo.
    echo Setting up environment...
    call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat" > nul 2>&1
    echo.
    echo Starting DrawMeSomething in development mode...
    echo Press Ctrl+C to stop the dev server.
    echo.
    cd /d "%~dp0"
    npm run tauri dev
) else (
    echo ERROR: Visual Studio or Build Tools not found!
    echo.
    echo Please install Visual Studio Build Tools:
    echo 1. Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo 2. Run the installer
    echo 3. Select "Desktop development with C++" workload
    echo 4. Complete the installation
    echo 5. Run this script again
    echo.
    pause
)
