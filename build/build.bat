@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0.."

echo ============================================
echo   Prostoy Redaktor - installer build
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js was not found.
  echo Download and install Node.js ^(LTS, version 18 or newer^) from https://nodejs.org
  echo Then run this file again.
  goto :error
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo [Error] Installed Node.js version is too old:
  node -v
  echo Node.js 18 or newer is required. Update it from https://nodejs.org
  goto :error
)

echo Found Node.js:
node -v
echo.

echo Installing dependencies ^(this can take a few minutes, requires internet^)...
call npm install
if errorlevel 1 (
  echo.
  echo [Error] Failed to install dependencies. Check your internet connection.
  goto :error
)

set CSC_IDENTITY_AUTO_DISCOVERY=false

echo.
echo Building installer ^(NSIS .exe^)...
call npm run dist
if errorlevel 1 (
  echo.
  echo [Error] Building the installer failed. See the messages above.
  echo.
  echo If the error mentions "symbolic link" or "privilege", Windows is
  echo blocking creation of symlinks for a helper tool. Fix one of two ways:
  echo   1^) Turn ON Developer Mode: Settings ^> Privacy ^& security ^>
  echo      For developers ^> Developer Mode, then run this file again.
  echo   2^) Or right-click this file and choose "Run as administrator".
  goto :error
)

echo.
echo ============================================
echo   Done! The installer is in the folder:
echo   %~dp0..\dist_installer
echo ============================================
start "" "%~dp0..\dist_installer"
pause
exit /b 0

:error
echo.
echo Build stopped due to an error. See the messages above.
pause
exit /b 1
