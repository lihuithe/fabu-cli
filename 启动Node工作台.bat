@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更高版本。
  pause
  exit /b 1
)
node --input-type=module -e "await Promise.all(['express', 'multer', 'playwright', 'open'].map(name => import(name)))" >nul 2>nul
if errorlevel 1 (
  echo 首次运行，正在安装依赖...
  where cnpm >nul 2>nul
  if errorlevel 1 (
    call npm install
  ) else (
    call cnpm install
  )
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
)
node scripts/start-web.js
pause
