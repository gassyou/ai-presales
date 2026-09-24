#!/usr/bin/env bash
# scripts/post-build-mac.sh
# ----------------------------------------------------------------------------
# 跨平台编译 macOS .app bundle 的后处理：
#   deno desktop 在 Linux 主机上产出 .app 时，Mach-O 二进制文件权限不会带 +x，
#   导致 launchd 拒绝 spawn（错误 111 / RBSRequestErrorDomain Code=5）。
#   本脚本在 Linux 端先把 Mach-O 设为可执行，Mac 端只需补签名 + open。
#
# 用法：
#   ./scripts/post-build-mac.sh                       # 默认 dist/ai-presales-mac.app
#   ./scripts/post-build-mac.sh dist/foo.app          # 指定路径
# ----------------------------------------------------------------------------
set -euo pipefail

APP_PATH="${1:-build/ai-presales-mac.app}"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ 找不到 app bundle: $APP_PATH"
  echo "   先跑: deno desktop -A --no-check --target aarch64-apple-darwin \\"
  echo "           -o $(dirname "$APP_PATH")/ai-presales-mac main.ts"
  exit 1
fi

MACOS_DIR="$APP_PATH/Contents/MacOS"
if [ ! -d "$MACOS_DIR" ]; then
  echo "❌ 不是合法的 .app bundle（缺少 Contents/MacOS）: $APP_PATH"
  exit 1
fi

echo "→ 修复可执行权限：$APP_PATH/Contents/MacOS/*"
chmod +x "$APP_PATH"
chmod +x "$MACOS_DIR"/*

echo ""
echo "✅ 修复后权限："
ls -la "$MACOS_DIR/"

echo ""
echo "→ 把前端 dist/ 嵌入 .app/Contents/Resources/dist（让 .app 自包含）"
RESOURCES_DIR="$APP_PATH/Contents/Resources"
APP_DIST="$RESOURCES_DIR/dist"
SOURCE_DIST="$(cd "$(dirname "$APP_PATH")/.." 2>/dev/null && pwd)/dist"

# 兜底：直接拿当前工作目录下的 dist（脚本通常是跨目录调用的）
if [ ! -d "$SOURCE_DIST" ]; then
  SOURCE_DIST="$(pwd)/dist"
fi
if [ ! -d "$SOURCE_DIST" ] && [ -d "$(pwd)/../dist" ]; then
  SOURCE_DIST="$(pwd)/../dist"
fi

if [ ! -d "$SOURCE_DIST" ] || [ ! -f "$SOURCE_DIST/index.html" ]; then
  echo "❌ 找不到前端 dist/（期待 dist/index.html 存在）"
  echo "   当前脚本目录: $(pwd)"
  echo "   尝试过的源路径: $APP_PATH 上级/dist, $(pwd)/dist"
  echo "   先跑 deno task build:frontend 构建前端。"
  exit 1
fi

mkdir -p "$RESOURCES_DIR"
# 用 ditto 保留资源分支（macOS 上更稳）；--noclobber 失败忽略
rm -rf "$APP_DIST"
mkdir -p "$APP_DIST"
cp -R "$SOURCE_DIST"/. "$APP_DIST"/
echo "✅ dist 已嵌入: $APP_DIST"
ls -la "$APP_DIST/"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " 下一步（拷贝到 Mac 上后执行）："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  cd $(basename "$(dirname "$APP_PATH")")"
echo "  codesign --force --deep --sign - $(basename "$APP_PATH")"
echo "  xattr -dr com.apple.quarantine $(basename "$APP_PATH")"
echo "  open $(basename "$APP_PATH")"
echo ""
echo "（如 ad-hoc 签名后仍弹\"未识别开发者\"，去"
echo " 系统设置 → 隐私与安全性 → 仍要打开）"
