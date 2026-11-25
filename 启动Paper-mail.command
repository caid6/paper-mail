#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="$PWD/.runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

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
if [[ ! -d node_modules/tsx || ! -f .runtime/npm.sha256 || "$(<.runtime/npm.sha256)" != "$dependency_stamp" ]]; then
  npm ci --no-audit --no-fund
  print -r -- "$dependency_stamp" > .runtime/npm.sha256
fi
npm run setup:python || {
  result=$?
  if [[ "$result" == 2 ]]; then open https://www.python.org/downloads/macos/; fi
  exit "$result"
}
npm run build
node scripts/service.mjs install
