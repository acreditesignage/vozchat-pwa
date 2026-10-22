@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node.js 20 ou superior em https://nodejs.org/
  pause
  exit /b 1
)
start "Servidor VozChat" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
