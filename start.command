#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v node >/dev/null 2>&1; then
  echo "正在使用 Node.js 启动本地相册服务..."
  exec node scripts/serve.mjs
fi

PY_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PY_CMD="python"
fi

if [ -n "$PY_CMD" ]; then
  echo "正在使用 Python 启动本地相册服务：http://localhost:8000/"
  echo "按 Ctrl+C 停止服务。"
  (sleep 1 && open "http://localhost:8000/") >/dev/null 2>&1 &
  exec "$PY_CMD" -m http.server 8000 --bind 127.0.0.1
fi

echo ""
echo "未检测到 Node.js 或 Python，无法启动本地静态服务。"
echo "请先安装任意一种工具后重新双击运行本脚本："
echo "  - Node.js: https://nodejs.org/"
echo "  - Python : https://www.python.org/"
echo ""
read -r -p "按回车键退出..."
exit 1
