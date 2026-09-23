#!/usr/bin/env bash
# scripts/build-and-launch-mac.sh
# ----------------------------------------------------------------------------
# 在 macOS (Apple Silicon) 上从源码重新编译 .app 并启动。
# 必须：Mac 上已安装 Deno（https://docs.deno.com/runtime/getting_started/installation/）
#
# 用法（在项目根目录）：
#   ./scripts/build-and-launch-mac.sh
#
# 为什么需要在 Mac 上重编，而不是从 Linux 拷贝过来？
#   deno desktop 在 Linux 上交叉编译时，Deno SDK 不知道 macOS Big Sur+ 把
#   系统库搬到了 /Library/Apple/usr/lib/。产生的 libruntime.dso 仍硬编码
#   /usr/lib/libstdc++.6.dylib 等路径，启动时 dyld 找不到 → launchd 报 111。
#   在 macOS 上原生编译则会自动链接到正确路径。
# ----------------------------------------------------------------------------
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "❌ 此脚本必须在 macOS 上运行（当前: $(uname)）"
  exit 1
fi

if ! command -v deno >/dev/null 2>&1; then
  echo "❌ 未检测到 deno 命令。"
  echo "   安装: curl -fsSL https://deno.land/install.sh | sh"
  exit 1
fi

if ! command -v codesign >/dev/null 2>&1; then
  echo "❌ 未检测到 codesign，需要安装 Xcode Command Line Tools:"
  echo "   xcode-select --install"
  exit 1
fi

if ! command -v xattr >/dev/null 2>&1; then
  echo "❌ 未检测到 xattr（macOS 自带；如缺失说明环境异常）"
  exit 1
fi

echo "→ 在 macOS 上原生编译 .app（避免 Linux 交叉编译的 dylib 路径问题）"
deno desktop -A --no-check --target aarch64-apple-darwin \
  -o ai-presales-mac main.ts

echo ""
echo "→ 修复 Mach-O 可执行权限"
./scripts/post-build-mac.sh ai-presales-mac.app

echo ""
echo "→ ad-hoc 签名（绕过 Gatekeeper / dyld 校验）"
codesign --force --deep --sign - ai-presales-mac.app

echo ""
echo "→ 移除 quarantine 属性（如果是解压/下载来的）"
xattr -dr com.apple.quarantine ai-presales-mac.app || true

echo ""
echo "→ 验证签名"
codesign --verify --strict --deep ai-presales-mac.app \
  && echo "✅ 签名校验通过" \
  || echo "⚠️  签名校验失败"

echo ""
echo "→ 启动应用"
open ai-presales-mac.app
echo "✅ 完成！如果还弹\"未识别开发者\"，去 系统设置 → 隐私与安全性 → 仍要打开"