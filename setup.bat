@echo off
REM ============================================================
REM  Smart School IoT - One-shot setup (Windows)
REM  Installs Node.js dashboard deps + builds the ESP32 firmware
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo === Smart School IoT - Setup ===
echo.

REM --- 1. Check Node.js ---
where node >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js is not installed. Download from https://nodejs.org
    pause
    exit /b 1
)

REM --- 2. Install dashboard dependencies ---
echo [setup] Installing Node.js dependencies...
cd dashboard
call npm install
if errorlevel 1 (
    echo [error] npm install failed.
    cd ..
    pause
    exit /b 1
)
cd ..

REM --- 3. Build ESP32 firmware via PlatformIO ---
set PIO_EXE=%USERPROFILE%\.platformio\penv\Scripts\pio.exe
if not exist "%PIO_EXE%" (
    echo [warning] PlatformIO is not installed at %PIO_EXE%
    echo [warning] Install the "PlatformIO IDE" extension in VS Code/Cursor/Kiro,
    echo [warning] then re-run this script, or build manually with PlatformIO: Build.
) else (
    echo [setup] Building ESP32 firmware...
    "%PIO_EXE%" run
    if errorlevel 1 (
        echo [error] Firmware build failed.
        pause
        exit /b 1
    )
)

echo.
echo === Setup complete ===
echo.
echo Run the dashboard:    start.bat   (or  cd dashboard ^& npm start)
echo Run the simulation:   open diagram.json in your IDE, then F1 ^> Wokwi: Start Simulator
echo.
pause
endlocal
