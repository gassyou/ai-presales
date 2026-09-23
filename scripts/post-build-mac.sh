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

APP_PATH="${1:-dist/ai-presales-mac.app}"

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
