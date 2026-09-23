# ai-presales

AI 预销售辅助系统 —— 帮助销售团队在售前阶段高效产出方案、报价、PPT 和邮件。

## 功能模块

- **项目（Project）**：售前项目主数据 + 联系人 + 团队成员
- **商务模块（Business Module）**：硬件清单 / 预算 / 调研任务 / 结构化资料 / PPT 大纲
- **AI 聊天（AI Chat）**：流式聊天 + 工具调用 + context budget 控制
- **Sub-Agent**：5 个内置 sub-agent（项目创建 / 调研 / 资料生成 / 报价 / PPT 生成），可在 `/settings` 配置
- **邮件（Mail）**：草稿 + 附件 + SMTP 真实发送（账号在 `/settings` 配置）
- **系统设置（Settings）**：LLM profiles / 邮件账号 / 工具配置 / Sub-Agent specs（阶段 7.4h）

## 技术栈

- **后端**：Deno 2.9 + `@db/sqlite` + 自研 DDD 架构（`class` + `private` + `Result<T,E>` + branded IDs）
- **前端**：Vue 3 + Pinia + Vue Router + TailwindCSS + Vite
- **存储**：SQLite（迁移管理）+ filesystem（附件 / .eml）
- **协议**：SMTP（手写最小客户端）+ REST API

## 启动

```bash
# 后端
deno task dev         # 启动 API（监听 8000）

# 前端
cd frontend && npm run dev   # Vite dev server（5173）

# 验证
deno task check        # TS 检查
deno test --no-check -A # 全套测试（490+）
cd frontend && npm run build # 前端 build
```

## 路线图（Roadmap）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 7.4a-f | 项目 / 商务模块 / AI chat / Sub-Agent / 邮件草稿 | ✅ |
| **7.4h** | **系统设置页（LLM profiles / 邮件账号 / 工具配置 / Sub-Agent specs）+ SMTP 集成** | **✅** |
| 7.5 | 多用户隔离 / 审计日志 | ⏳ |
| 7.6 | 工具自定义 / Agent 导入导出 | ⏳ |

## 7.4h 详情

**新增**：
- 后端：`backend/domain/settings/*`（4 个 typed aggregate）+ `backend/persistence/sqlite/sqlite-system-setting.repository.ts` + `sqlite-sub-agent-registry.ts` + `backend/application/settings/*`（use case / resolver / configurable tool registry）+ `backend/infrastructure/mail/smtp-transport.ts` + `backend/presentation/routes/settings.route.ts`
- 前端：`frontend/src/features/settings/*`（4 tab + store + api + view）
- 迁移：`010_system_settings.sql.ts`

**关键特性**：
- 乐观并发：GET 返回 `updated_at`，PUT 回带；不匹配返回 409 CONFLICT
- 热生效：改完无需重启，下次调用拿新配置；LLM client cache / Tool config / Sub-agent spec / ContextAssembler 全部 hot-reload
- SMTP 集成：手写 SMTP 客户端（~400 LOC），支持 AUTH LOGIN / STARTTLS / 附件

**测试**：490 个测试通过（settings.usecase 13 + sqlite-sub-agent-registry 4 + llm-client-resolver 4 + settings.route 13 + configure 7 + mail-send 6 = 47 新增）。
