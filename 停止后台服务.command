#!/bin/zsh
set -e
cd "$(dirname "$0")"
node scripts/service.mjs stop
print '后台服务已停止。再次双击“启动知更.command”可恢复。'
