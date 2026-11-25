#!/bin/zsh
set -e
cd "$(dirname "$0")"
export PATH="$PWD/.runtime/node/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
node scripts/service.mjs stop
print '再次双击“启动Paper-mail.command”即可恢复。'
