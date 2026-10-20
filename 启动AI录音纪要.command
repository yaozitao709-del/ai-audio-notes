#!/bin/bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$APP_ROOT/runtime/bin/node" ]; then
  exec "$APP_ROOT/runtime/bin/node" "$APP_ROOT/scripts/launcher.mjs" start
elif command -v node >/dev/null 2>&1; then
  exec node "$APP_ROOT/scripts/launcher.mjs" start
else
  echo "未找到 Node.js。请下载包含运行环境的完整 Mac ZIP，或安装 Node.js 26+。"
  exit 1
fi
