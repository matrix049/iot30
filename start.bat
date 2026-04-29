@echo off
REM ===========================================================
REM  Smart School IoT - Quick start (Windows)
REM  Lance le dashboard Node.js, puis ouvrez Wokwi dans VS Code
REM ===========================================================

setlocal
cd /d "%~dp0dashboard"
if errorlevel 1 (
    echo [erreur] Dossier dashboard introuvable.
    pause
    exit /b 1
)

echo.
echo === Smart School IoT - Dashboard ===
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo [erreur] npm introuvable. Installe Node.js depuis https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [setup] Installation des dependances Node.js...
    call npm install
    if errorlevel 1 (
        echo [erreur] npm install a echoue.
        pause
        exit /b 1
    )
)

echo [info] Dashboard sur http://localhost:3000
echo [info] Ctrl+C pour arreter le serveur.
echo.
echo [next] Dans VS Code : ouvrir diagram.json puis F1 ^> Wokwi: Start Simulator
echo.

call npm start

echo.
echo [info] Le serveur s'est arrete. Appuie sur une touche pour fermer.
pause >nul
endlocal
