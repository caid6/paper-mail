#!/bin/zsh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  print '需要安装 Node.js 22.13 或更高版本：https://nodejs.org/'
  read '?按回车退出'; exit 1
fi
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
if [ ! -f dist/index.html ]; then npm run build; fi
node scripts/service.mjs install
open http://127.0.0.1:4317
