@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo O THEIBS WebApp precisa do Node.js 22 ou superior.
  echo Instale pelo site https://nodejs.org/ e execute este arquivo novamente.
  pause
  exit /b 1
)
node webapp.js
if errorlevel 1 pause
