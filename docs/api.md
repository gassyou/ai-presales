# API 契约

## 资源命名

- 复数名词：`/api/projects`、`/api/projects/:id`
- 嵌套只一层：`/api/projects/:id/sessions`
- 子资源操作：`POST /api/projects/:id/archive`
- AI 动作：`/api/ai/chat`、`/api/ai/chat/stream`

## 错误响应

统一 `ErrorEnvelope`：

```ts
interface ErrorEnvelope {
  code: string;          // 机器可读（见 ErrorCode 枚举）
  message: string;       // 人读
  details?: unknown;     // 字段级错误等
  traceId: string;       // 与日志关联
}
```

| HTTP | code | 场景 |
|---|---|---|
| 400 | VALIDATION_FAILED | 入参校验失败 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | CONFLICT | 业务冲突（如重名） |
| 499 | ABORTED | 客户端取消 |
| 500 | INTERNAL | 未预期错误 |
| 502 | LLM_AUTH_FAILED | LLM 认证失败 |
| 502 | LLM_UPSTREAM_ERROR | LLM 上游错误 |
| — | LLM_CONTEXT_OVERFLOW | 上下文超出 |
| — | EXTENSION_MISSING | SQLite 扩展缺失 |
| — | TOOL_NOT_FOUND | 工具未注册 |
| — | TOOL_EXECUTION_FAILED | 工具执行失败 |

## 流式端点

`POST /api/ai/chat/stream`

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: chunk
data: {"type":"chunk","delta":"你","messageId":"..."}

event: done
data: {"type":"done","messageId":"...","usage":{...}}

```

- 30 秒无心跳客户端自动重连（重连时带 `Last-Event-ID`）
- 客户端必须用 fetch + ReadableStream（不能用 EventSource，因为 POST body）

## 静态资源

生产模式下后端托管 `dist/`：
- `/` 返回 `dist/index.html`
- 其他非 `/api/*` 路径走 SPA fallback（找不到时也返回 `index.html`）
- 静态资源设 `cache-control: public, max-age=3600`
