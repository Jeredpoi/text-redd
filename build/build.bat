@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
REM Сборка установщика "Простой Редактор" для Windows.
REM Требуется установленный Node.js (https://nodejs.org, версия 18 или новее).

cd /d "%~dp0.."

echo ============================================
echo   Простой Редактор — сборка установщика
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [Ошибка] Node.js не найден.
  echo Скачайте и установите Node.js ^(LTS, версия 18 или новее^) с https://nodejs.org
  echo После установки запустите этот файл ещё раз.
  goto :error
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo [Ошибка] Установлена слишком старая версия Node.js:
  node -v
  echo Нужна версия 18 или новее. Обновите Node.js с https://nodejs.org
  goto :error
)

echo Найден Node.js:
node -v
echo.

echo Установка зависимостей ^(может занять несколько минут, нужен интернет^)...
call npm install
if errorlevel 1 (
  echo.
  echo [Ошибка] Не удалось установить зависимости. Проверьте подключение к интернету.
  goto :error
)

echo.
echo Сборка установщика ^(NSIS .exe^)...
call npm run dist
if errorlevel 1 (
  echo.
  echo [Ошибка] Сборка установщика не удалась. Смотрите сообщения выше.
  goto :error
)

echo.
echo ============================================
echo   Готово! Установщик находится в папке:
echo   %~dp0..\dist_installer
echo ============================================
start "" "%~dp0..\dist_installer"
pause
exit /b 0

:error
echo.
echo Сборка прервана из-за ошибки. Смотрите сообщения выше.
pause
exit /b 1
