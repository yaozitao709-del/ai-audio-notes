#!/bin/bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$APP_ROOT/runtime/bin/node" ]; then
  exec "$APP_ROOT/runtime/bin/node" "$APP_ROOT/scripts/launcher.mjs" stop
elif command -v node >/dev/null 2>&1; then
  exec node "$APP_ROOT/scripts/launcher.mjs" stop
else
  echo "未找到本软件运行环境。"
  exit 1
fi
