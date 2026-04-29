#!/usr/bin/env bash
# ===========================================================
#  Smart School IoT - Quick start (Linux / macOS)
#  Lance le dashboard Node.js, puis ouvrez Wokwi dans VS Code
# ===========================================================
set -e

cd "$(dirname "$0")/dashboard"

echo
echo "=== Smart School IoT - Dashboard ==="
echo

if [ ! -d "node_modules" ]; then
    echo "[setup] Installation des dépendances Node.js..."
    npm install
fi

echo "[info] Dashboard sur http://localhost:3000"
echo "[info] Ctrl+C pour arrêter le serveur."
echo
echo "[next] Dans VS Code : ouvrir diagram.json puis F1 > Wokwi: Start Simulator"
echo

exec npm start
