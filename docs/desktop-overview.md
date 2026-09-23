# Deno Desktop 速查

> 本项目使用 `deno desktop`（Deno v2.9+ 内置）作为桌面入口。本文档汇总 desktop 相关事实，避免后续踩坑。

## 三种启动模式

| 模式 | 命令 | 用途 |
|---|---|---|
| **桌面模式** | `deno desktop main.ts` 或 `deno task start` | 生产形态：webview 窗口加载本地 server |
| **开发后端** | `deno task dev:backend` | 仅跑 deno 后端，用浏览器调试前端（推荐） |
| **开发前端** | `deno task dev:frontend` | 仅跑 vite dev server，调用 deno 后端 |

我们 `main.ts` 和 `dev.ts` 都做了**自动检测**：通过 `DENO_SERVE_ADDRESS` 环境变量判断是否在 desktop 模式。

## Backend 选择

```jsonc
// deno.json
{
  "desktop": {
    "backend": "webview"   // 默认
  }
}
```

| | `webview`（默认） | `cef` | `raw` |
|---|---|---|---|
| 大小 | ~1MB | ~150MB | ~1MB |
| DevTools | ❌ | ✅ | — |
| 跨平台一致性 | ❌ | ✅ | — |
| WebGPU | 部分平台 | ✅ 全平台 | — |
| 推荐场景 | 通用 web UI | 需要 DevTools / WebGPU / 一致性 | 自定义渲染 |

切到 CEF（仅当需要 DevTools）：

```bash
deno desktop --backend cef main.ts
```

## BrowserWindow

```ts
// 第一次 new 会 adopt 隐式启动窗口；后续 new 才是开新窗口
const win = new Deno.BrowserWindow({
  title: "AI 提案协助",
  width: 1280,
  height: 800,
});

const port = Deno.env.get("DENO_SERVE_ADDRESS")!.split(":").pop();
win.navigate(`http://127.0.0.1:${port}/`);

// 常用 API
win.show(); win.hide(); win.focus(); win.close();
win.setSize(800, 600); win.setPosition(100, 100);
win.setTitle("...");
win.reload();
win.executeJs("document.title");   // 在 webview 中跑 JS，必须 JSON 序列化
```

事件（addEventListener）：

- `resize`, `move`, `focus`, `blur`, `close`
- `keydown`, `keyup`, `mousemove`, `mousedown`, `mouseup`, `click`, `dblclick`, `wheel`
- `menuclick`, `contextmenuclick`

## Bindings（IPC 高速通道）

```ts
// deno 端
win.bind("saveFile", async (name: string, content: string) => {
  await Deno.writeTextFile(name, content);
  return { ok: true };
});

// webview 端（自动注入 window.bindings）
await window.bindings.saveFile("foo.txt", "hello");
```

Args/return 必须 JSON 序列化。bypass HTTP，比 `fetch` 快。

## Menus

```ts
win.setApplicationMenu([
  {
    submenu: {
      label: "File",
      items: [
        { item: { label: "Save", id: "save", accelerator: "CmdOrCtrl+S", enabled: true } },
        { role: { role: "quit" } },  // OS 标准 role
      ],
    },
  },
]);

win.addEventListener("menuclick", (e) => {
  if (e.detail.id === "save") { /* ... */ }
});
```

加速键格式：`CmdOrCtrl+S`、`CmdOrCtrl+Shift+N`、单键 `F11`。

**注意**：webview 模式下 webview **不**转发浏览器的 `contextmenu` 事件，要监听右键菜单需用 `mousedown` + `e.button === 2`：

```ts
win.addEventListener("mousedown", (e) => {
  if (e.button === 2) win.showContextMenu(e.clientX, e.clientY, contextMenu);
});
```

## Dialogs（alert/confirm/prompt）

在 deno 端调用时，是**原生模态对话框**（不走终端）：

```ts
if (confirm("Delete this project?")) {
  // ...
}
const name = prompt("New project name:", "Untitled");
```

**没有 first-class 的 file/folder picker API**。文件选择必须走 webview：

```html
<input id="f" type="file" accept=".json">
<script>
  document.getElementById("f").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    await window.bindings.handleFile(file.name, await file.arrayBuffer());
  });
</script>
```

```ts
win.bind("handleFile", async (name, bytes) => {
  await Deno.writeFile(name + ".bak", new Uint8Array(bytes));
});
```

## HTTP serving 模式

`Deno.serve()` 在 desktop 模式下**不需要传端口**——runtime 自动选本地空闲端口，通过 `DENO_SERVE_ADDRESS` 注入：

```ts
// ✅ 正确：desktop + deno-run 都兼容
Deno.serve(undefined, handler);

// ❌ 错误：desktop 模式下 port 会被忽略
Deno.serve({ port: 8000 }, handler);
```

我们的 `main.ts` / `dev.ts` 已自动检测：

```ts
const isDesktopMode = Deno.env.get("DENO_SERVE_ADDRESS") !== undefined;
Deno.serve(isDesktopMode ? undefined : { port: 8000 }, handler);
```

## 跨窗口共享

所有窗口共享同一个 Deno runtime（一个进程）。可通过 `win.windowId` 区分。

每个窗口：
- 独立 webview
- 独立 bindings（`win.bind()` 注册到该窗口的 webview）
- 默认从同一个 `Deno.serve` 加载；用 path 区分

```ts
const settings = new Deno.BrowserWindow({ title: "Settings", width: 420, height: 320 });
settings.navigate(`http://127.0.0.1:${port}/settings`);
```

## 退出应用

```ts
// 阻止窗口关闭（用于"是否保存"提示）
win.addEventListener("close", (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    // 业务逻辑
  }
});

// 强制退出
Deno.exit(0);
```

## 已知限制

- **WebView backend 无 DevTools**——调试时临时切到 `cef`
- **WebView backend 不转发 `contextmenu` 事件**——右键菜单需自己监听 `mousedown`
- **webview 跨平台一致性弱**——macOS WKWebView / Windows WebView2 / Linux WebKitGTK 行为可能略有差异
- **没有 first-class file/folder picker**——必须走 `<input type="file">` + bindings
- **没有 first-class clipboard API（deno 端）**——webview 用 `navigator.clipboard`
- **deno.serve 端口不可指定**（desktop 模式下）——runtime 自动选
