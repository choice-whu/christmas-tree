@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  echo 正在使用 Node.js 启动本地相册服务...
  node scripts\serve.mjs
  if errorlevel 1 pause
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo 正在使用 Python 启动本地相册服务：http://localhost:8000/
  echo 按 Ctrl+C 停止服务。
  start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:8000/"
  python -m http.server 8000 --bind 127.0.0.1
  if errorlevel 1 pause
  exit /b %errorlevel%
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo 正在使用 Python 启动本地相册服务：http://localhost:8000/
  echo 按 Ctrl+C 停止服务。
  start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:8000/"
  py -3 -m http.server 8000 --bind 127.0.0.1
  if errorlevel 1 pause
  exit /b %errorlevel%
)

echo.
echo 未检测到 Node.js 或 Python，无法启动本地静态服务。
echo 请先安装任意一种工具后重新双击运行本脚本：
echo   - Node.js: https://nodejs.org/
echo   - Python : https://www.python.org/
echo.
pause
exit /b 1
