#!/usr/bin/env bash
# ============================================================
#  Smart School IoT - One-shot setup (Linux / macOS)
#  Installs Node.js dashboard deps + builds the ESP32 firmware
# ============================================================
set -e

cd "$(dirname "$0")"

echo
echo "=== Smart School IoT - Setup ==="
echo

# --- 1. Check Node.js ---
if ! command -v node >/dev/null 2>&1; then
    echo "[error] Node.js is not installed. Get it from https://nodejs.org"
    exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "[error] Node.js >= 18 required (you have $(node -v))"
    exit 1
fi

# --- 2. Install dashboard dependencies ---
echo "[setup] Installing Node.js dependencies..."
cd dashboard
npm install
cd ..

# --- 3. Build ESP32 firmware via PlatformIO ---
PIO_EXE="$HOME/.platformio/penv/bin/pio"
if [ ! -x "$PIO_EXE" ]; then
    echo "[warning] PlatformIO not found at $PIO_EXE"
    echo "[warning] Install the 'PlatformIO IDE' extension in your editor,"
    echo "[warning] then build the firmware via 'PlatformIO: Build' or re-run this script."
else
    echo "[setup] Building ESP32 firmware..."
    "$PIO_EXE" run
fi

echo
echo "=== Setup complete ==="
echo
echo "Run the dashboard:    ./start.sh    (or  cd dashboard && npm start)"
echo "Run the simulation:   open diagram.json in your IDE, then F1 > Wokwi: Start Simulator"
echo
