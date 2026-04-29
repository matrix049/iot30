# Requirements

All dependencies needed to run **Smart School IoT** on a fresh machine.

---

## 1. System requirements

| Component | Minimum version | Where to get it |
|---|---|---|
| **Node.js** | 18 (LTS recommended) | <https://nodejs.org> |
| **npm** | 8 (ships with Node.js) | — |
| **Git** | any recent | <https://git-scm.com> |
| **VS Code / Cursor / Kiro** | latest | — |
| **PlatformIO IDE** (VS Code extension) | latest | Marketplace search "PlatformIO IDE" |
| **Wokwi for VS Code** (extension) | latest | Marketplace search "Wokwi Simulator" |
| **Internet connection** | required | — for the public MQTT broker |

> Windows users: PowerShell ships with Windows 10/11. No extra shell required.

---

## 2. ESP32 firmware libraries

Declared in [`platformio.ini`](platformio.ini), auto-installed on first build.

| Library | Version | Purpose |
|---|---|---|
| `knolleary/PubSubClient` | ^2.8 | MQTT client |
| `adafruit/DHT sensor library` | ^1.4.4 | DHT22 reader |
| `adafruit/Adafruit Unified Sensor` | ^1.1.9 | DHT lib dependency |
| `bblanchon/ArduinoJson` | ^6.21.3 | JSON encode/decode |

---

## 3. Dashboard (Node.js) dependencies

Declared in [`dashboard/package.json`](dashboard/package.json), installed by `npm install`.

### Runtime
| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.18.2 | HTTP server + REST routes |
| `mqtt` | ^5.3.4 | MQTT client (broker connection) |
| `socket.io` | ^4.6.1 | WebSocket transport for real-time updates |

### Development
| Package | Version | Purpose |
|---|---|---|
| `nodemon` | ^3.0.1 | Auto-reload during development (`npm run dev`) |

No Python needed. No database server needed (local JSON storage; schema compatible MySQL for production).

---

## 4. One-shot setup

Run **one** of these from the project root after cloning:

**Windows**
```powershell
setup.bat
```

**Linux / macOS**
```bash
./setup.sh
```

The script will:
1. Verify Node.js ≥ 18
2. Run `npm install` in `dashboard/`
3. Build the ESP32 firmware via PlatformIO (if installed)

If PlatformIO isn't on your `PATH`, install the **PlatformIO IDE** extension in your editor first, then re-run the script — or build the firmware manually via `PlatformIO: Build`.

---

## 5. Manual install (alternative)

```bash
# Dashboard
cd dashboard
npm install

# Firmware
# Option A — IDE: open the project, install PlatformIO IDE extension, run "PlatformIO: Build"
# Option B — CLI (Windows PowerShell):
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run
# Option B — CLI (Linux/macOS):
~/.platformio/penv/bin/pio run
```

---

## 6. Hardware (for real deployment, optional)

The simulation runs entirely in **Wokwi** — no physical hardware needed.
For a physical deployment, you'd use:

- ESP32 dev board (any model)
- DHT22 temperature/humidity sensor
- HC-SR501 PIR motion sensor
- LDR (photoresistor) + 10kΩ resistor (voltage divider)
- Sound sensor module (or analog mic)
- MQ-135 air quality sensor
- IR receiver module
- 5V relay module
- 3 LEDs + 220–330Ω resistors
- Breadboard + jumper wires
