@echo off
title The Traitors Game Server
cd /d "%~dp0"

echo ========================================================
echo        THE TRAITORS - REALTIME GAME LAUNCHER
echo ========================================================
echo.
echo Checking port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo Freeing port 3000 from previous session...
    taskkill /f /pid %%a >nul 2>&1
)

echo Starting game server on port 3000...
echo Opening game in your browser...

timeout /t 1 >nul 2>&1

start http://localhost:3000/
start http://localhost:3000/secret-admin

set ELECTRON_RUN_AS_NODE=1
"C:\Users\Kartavya\AppData\Local\Programs\antigravity\Antigravity.exe" server.js

pause
