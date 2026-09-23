# 打包

## Backend 选择

Deno Desktop 支持三种渲染 backend，在 `deno.json` 里配置：

```json
{
  "desktop": {
    "backend": "webview"
  }
}
```

或通过 CLI flag：`deno desktop --backend webview main.ts`。

### 三种 backend 对比

| 维度 | `webview`（默认） | `cef` | `raw` |
|---|---|---|---|
| 引擎 | WKWebView / WebView2 / WebKitGTK（OS 自带） | Chromium Embedded Framework | 无 webview，仅窗口/事件 |
| 框架大小 | ~1 MB | ~150 MB | ~1 MB |
| 跨平台渲染一致 | ❌ 因 OS 而异 | ✅ 一致 | — |
| DevTools | ❌ | ✅ | — |
| 完整 web 特性 | 部分（WebGPU/Web Audio 等可能缺） | 全部（含 WebGPU on Linux） | — |
| 适合 | 体积敏感、UI 用通用 web 特性 | 需要 DevTools 调试、跨平台一致性、WebGPU | 自定义渲染（WebGPU/Skia）、非 web 程序 |
| 业务场景 | 个人/小团队桌面应用 | 企业级、对一致性要求高 | 不适用本项目 |

### 本项目推荐：默认 `webview`

理由：
- 业务 UI（工作台、表单、表格、脑图、Markdown 编辑器）都是通用 web 特性
- 体积小
- macOS 上 WKWebView 体验良好

需要 DevTools 调试时，临时切换到 `cef`：

```bash
# 临时用 CEF（不影响 deno.json 配置）
deno desktop --backend cef main.ts
```

或修改 `deno.json`：

```json
{
  "desktop": { "backend": "cef" }
}
```

## deno serve 在 desktop 模式下的特殊行为

**重要**：`deno desktop` 模式下，端口由 desktop 运行时**自动选择**，用户传的 port 会被忽略：

- 注入 `DENO_SERVE_ADDRESS` 环境变量（形如 `tcp:127.0.0.1:54321`）
- 调用 `Deno.serve(...)` 时**不传 port**，或传 port 会被忽略
- webview 不会自启动，需要手动 `new Deno.BrowserWindow()` + `navigate("http://127.0.0.1:<port>/")`

我们的 `main.ts` 已自动检测：

```ts
const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;
const serveOptions = isDesktopMode ? undefined : { hostname, port, onListen };

const server = Deno.serve(serveOptions, app.fetch);

if (isDesktopMode) {
  const port = Deno.env.get("DENO_SERVE_ADDRESS")!.split(":").pop();
  const win = new Deno.BrowserWindow({ title: "AI 提案协助", width: 1280, height: 800 });
  win.navigate(`http://127.0.0.1:${port}/`);
}
```

网络隔离：`127.0.0.1` 本地 loopback，二进制不绑定公网接口（即使传 `0.0.0.0` 也会被忽略）。

## deno compile

```bash
deno compile --desktop --output dist/ai-presales main.ts
```

带前端产物：

```bash
deno task build:frontend   # vite build → dist/
deno compile --desktop \
  --include=dist \
  --output dist/ai-presales main.ts
```

> 注意：阶段 7.7 起项目**不再携带 config.toml**。AI provider / embedding 等运行时配置全部保存在 SQLite `system_settings` 表中，由 `/#/settings` 页面管理。如需在编译时覆盖 server 端口等运维字段，仍可用 `AI_PRESALES_CONFIG=path/to/file.toml` 显式指向外部文件。

## 跨平台

各平台单独编译（无法在 mac 上打 win）：

```bash
# macOS（universal binary 或单 arch）
deno compile --desktop --target x86_64-apple-darwin \
  --include=dist \
  --output dist/ai-presales main.ts

deno compile --desktop --target aarch64-apple-darwin \
  --include=dist \
  --output dist/ai-presales-arm64 main.ts

lipo -create dist/ai-presales dist/ai-presales-arm64 -output dist/ai-presales-universal

# Windows（在 Windows 主机执行）
deno compile --desktop --target x86_64-pc-windows-msvc \
  --include=dist \
  --output dist/ai-presales.exe main.ts

# Linux
deno compile --desktop --target x86_64-unknown-linux-gnu \
  --include=dist \
  --output dist/ai-presales main.ts
```

**Backend 自动下载**：`--target` 切换平台时，`deno compile` 自动从官方下载对应平台的预编译 backend 二进制（~150MB for CEF，~1MB for webview），无需本地构建工具链。下载有 checksum 校验，缓存在 `<deno_dir>/`。

CI 建议：GitHub Actions matrix 各平台 runner。

## SQLite 扩展分发

**当前策略**：扩展文件不进入二进制，由应用首次启动按需拉取到 `<APP_DATA_DIR>/vendor/`。

```bash
deno task fetch:extensions
```

手动放置（自动下载失败时）：

```bash
# macOS
mkdir -p "$HOME/Library/Application Support/ai-presales/vendor"
cp vector.dylib "$HOME/Library/Application Support/ai-presales/vendor/"

# Linux
mkdir -p "$HOME/.local/share/ai-presales/vendor"
cp vector.so "$HOME/.local/share/ai-presales/vendor/"

# Windows
mkdir %APPDATA%\ai-presales\vendor
copy vector.dll %APPDATA%\ai-presales\vendor\
```

## 代码签名

**本次不签名**。正式发布前必须做的：

- macOS：Apple Developer ID + notarization（`codesign --deep --sign "Developer ID" dist/ai-presales`，`xcrun notarytool submit`）
- Windows：EV 代码签名证书 + signtool
- Linux：通常无需签名，但需要分发格式（deb/AppImage/rpm）

`deno.json` 留 `sign:mac` / `sign:win` 占位任务，正式发布前补全。

## 故障排查

| 现象 | 排查 |
|---|---|
| `deno compile` 后报 `dlopen failed` | 缺 SQLite 扩展；运行 `deno task fetch:extensions` |
| 应用启动后 webview 白屏 | 检查 desktop 模式 `DENO_SERVE_ADDRESS` 是否被正确读取；`curl http://localhost:8000/api/health` 验证 API 通 |
| 应用启动后前端报错 CORS | dev 模式下 vite 跨域调用 8000；生产模式 vite 已构建到 deno 静态托管，无 CORS |
| 想用 DevTools 调试 | 临时切换到 CEF：`deno desktop --backend cef main.ts` |
| CEF 首次下载很慢 | 正常，~150MB；下载一次后缓存在 `<deno_dir>/` |
| 编译 mac universal binary | 见上"跨平台"部分用 `lipo` 合并两个 arch 二进制 |