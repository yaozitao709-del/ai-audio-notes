#!/bin/bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:-start}"
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo "轻量版目前支持苹果芯片 Mac。"; exit 1
fi
if [ "$(uname -r | cut -d. -f1)" -lt 23 ]; then
  echo "需要 macOS 14 或更新版本。"; exit 1
fi
DATA_ROOT="${AI_AUDIO_DATA_ROOT:-$HOME/Library/Application Support/AI Audio Notes}"
CACHE_ROOT="${AI_AUDIO_CACHE_DIR:-$DATA_ROOT/runtime-cache}"
NODE_DIR="$CACHE_ROOT/node-v26.11.1-darwin-arm64"
usable_node() { [ -x "$1" ] && "$1" -e 'process.exit(process.platform==="darwin" && process.arch==="arm64" && Number(process.versions.node.split(".")[0])>=26 ? 0 : 1)' >/dev/null 2>&1; }
NODE_BIN=""
PREVIOUS_NODE="$(cat "$CACHE_ROOT/node-selection.txt" 2>/dev/null || true)"
if [ -n "${AI_AUDIO_NODE:-}" ]; then
  CANDIDATES=("$AI_AUDIO_NODE" "$APP_ROOT/runtime/bin/node" "$NODE_DIR/bin/node")
else
  CANDIDATES=("$APP_ROOT/runtime/bin/node" "$NODE_DIR/bin/node" "$PREVIOUS_NODE" "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node "$(dirname "$APP_ROOT")/AI-Audio-Notes/runtime/bin/node")
fi
for candidate in "${CANDIDATES[@]}"; do
  if [ -n "$candidate" ] && usable_node "$candidate"; then NODE_BIN="$candidate"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  if [ "$ACTION" = stop ]; then echo "未找到轻量版运行环境，无需关闭。"; exit 0; fi
  mkdir -p "$CACHE_ROOT/downloads"
  NODE_LOCK="$CACHE_ROOT/node-install.lock"
  if ! mkdir "$NODE_LOCK" 2>/dev/null; then
    old_pid="$(cat "$NODE_LOCK/pid" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then rm -f "$NODE_LOCK/pid"; rmdir "$NODE_LOCK"; mkdir "$NODE_LOCK";
    else echo "另一个启动程序正在准备 Node，请稍后重试。"; exit 1; fi
  fi
  echo $$ > "$NODE_LOCK/pid"
  trap 'rm -f "$NODE_LOCK/pid"; rmdir "$NODE_LOCK" 2>/dev/null || true' EXIT
  ARCHIVE="$CACHE_ROOT/downloads/node-v26.11.1-darwin-arm64.tar.gz"
  EXPECTED="d916511b55965e91be7a88e17f88d895b6793ceaba3e6c9b194aefe51c2c65ac"
  checksum() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }
  if [ ! -f "$ARCHIVE" ] || [ "$(checksum "$ARCHIVE")" != "$EXPECTED" ]; then
    echo "未找到兼容 Node.js，正在下载应用专用运行环境。"
    URL="https://nodejs.org/dist/v26.11.1/node-v26.11.1-darwin-arm64.tar.gz"
    /usr/bin/curl --disable --fail --location --retry 2 --connect-timeout 20 --proto '=https' --proto-redir '=https' --continue-at - "$URL" -o "$ARCHIVE.partial" || { rm -f "$ARCHIVE.partial"; /usr/bin/curl --disable --fail --location --retry 2 --proto '=https' --proto-redir '=https' "$URL" -o "$ARCHIVE.partial"; }
    if [ "$(checksum "$ARCHIVE.partial")" != "$EXPECTED" ]; then rm -f "$ARCHIVE.partial"; echo "Node 下载校验失败，请重新启动。"; exit 1; fi
    mv "$ARCHIVE.partial" "$ARCHIVE"
  fi
  STAGING="$CACHE_ROOT/node-unpack-$$"; mkdir -p "$STAGING"
  /usr/bin/tar -xzf "$ARCHIVE" -C "$STAGING"
  if [ -e "$NODE_DIR" ]; then mv "$NODE_DIR" "$NODE_DIR.before-lite-$$"; fi
  mv "$STAGING/node-v26.11.1-darwin-arm64" "$NODE_DIR"; rmdir "$STAGING"
  NODE_BIN="$NODE_DIR/bin/node"
  if ! usable_node "$NODE_BIN"; then echo "下载的 Node 未通过运行检查。"; exit 1; fi
  rm -f "$NODE_LOCK/pid"; rmdir "$NODE_LOCK"; trap - EXIT
fi
(umask 077; mkdir -p "$CACHE_ROOT"; printf '%s\n' "$NODE_BIN" > "$CACHE_ROOT/node-selection.$$.tmp")
mv "$CACHE_ROOT/node-selection.$$.tmp" "$CACHE_ROOT/node-selection.txt"
if [ "$ACTION" = --node-only ]; then echo "$NODE_BIN"; exit 0; fi
exec "$NODE_BIN" "$APP_ROOT/scripts/lite-setup.mjs" "$ACTION"
