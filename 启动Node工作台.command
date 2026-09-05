#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22.12 或更高版本。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi
if ! node --input-type=module -e "await Promise.all(['express', 'multer', 'playwright', 'open'].map(name => import(name)))" >/dev/null 2>&1; then
  echo "首次运行，正在安装依赖..."
  if command -v cnpm >/dev/null 2>&1; then
    cnpm install || exit 1
  else
    npm install || exit 1
  fi
fi
node scripts/start-web.js
