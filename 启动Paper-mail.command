#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="$PWD/.runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

print '[1/5] 检查 Node.js 与安装位置'
if ! node --no-warnings -e 'require("node:sqlite")' >/dev/null 2>&1 ||
   ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' ||
   ! command -v npm >/dev/null; then
  print '请用 Node.js 官网的 macOS 安装包安装 Node.js 22.13 或更新版本，再运行此脚本。'
  open https://nodejs.org/en/download
  exit 1
fi

node scripts/service.mjs check-location
mkdir -p .runtime
dependency_stamp=$(shasum -a 256 package-lock.json | cut -d ' ' -f 1)
print '[2/5] 检查网页依赖'
if [[ ! -d node_modules/tsx || ! -f .runtime/npm.sha256 || "$(<.runtime/npm.sha256)" != "$dependency_stamp" ]]; then
  npm ci --no-audit --no-fund
  print -r -- "$dependency_stamp" > .runtime/npm.sha256
fi
print '[3/5] 准备 PDF 环境'
if ! npm run setup:python; then
  print '将启动论文收取和摘要阅读。修复 PDF 环境后，再运行本脚本即可恢复全文处理。'
fi
print '[4/5] 构建网页'
npm run build
print '[5/5] 启动后台服务并打开收件箱'
node scripts/service.mjs install
