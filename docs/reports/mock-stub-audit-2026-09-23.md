# Mock / Stub 实现审计报告

**项目**: ai-presales (ai 提案辅助系统)
**审计时间**: 2026-09-23
**审计范围**: `backend/` + `frontend/src/` 全部代码 (read-only)
**审计方式**: 三个并行探索 agent 分别覆盖后端逻辑、前端 UI、DI/装配层

---

## TL;DR — 真正的 AI 功能表面积极小

整个项目标榜的"AI 提案辅助"中，**实际调用 LLM 的功能只有 2 个**：

1. **PPT 大纲流式生成** — `PptAiGenerateDialog` → `ppt.usecase.generatePages` 真 LLM 调用 + SSE 流式事件。
2. **商务邮件起草** — `EmailComposerDialog` "AI 起草" → `subAgentApi.invoke("business-email-writer")`。

其余所有标着 "AI 生成"、"AI 一键批量"、"智能" 的按钮 / 端点，要么走 `setTimeout` + 硬编码模板，要么干脆给前端返回 `INTERNAL` 错误。

**真实的基础设施** (确认无误)：
- LLM 客户端 (`@anthropic-ai/sdk`, `@openai/openai`) — 真正调用
- SMTP 邮件发送 (`Deno.startTls` + SMTP 命令 + MIME) — 真正发邮件
- SQLite 持久化、迁移、5 个内置 sub-agent 定义 — 真实
- ExcelJS 导出、PPT JSON 解析入库、Embedding HTTP 调用 — 真实
- SSE 流式框架 — 真实

---

## HIGH 严重度（用户直接可见）

### H1. FunctionListView "AI 生成（占位）" 按钮插入硬编码示例
- **前端按钮**: `frontend/src/features/business-module/components/FunctionListView.vue:8, 29-32, 285-293`
- **后端**: 不调用，直接在前端构造
- **真相**: 注释 `// 占位：插入 3 个示例功能（与 settings 计算对应）` 明示。点击直接 push 三条 `{category:"订单",module:"下单",name:"提交订单",cp:5,...}` 进 store。
- **影响**: 用户每点一次就重复插入同一批三条；标签诚实但 UI 整体没突出警告。
- **修复方向**: 调用 `subAgentApi.invoke("proposal-drafting", {input: "<当前项目背景>", context: "function-list"})`，或暂时把按钮隐藏 / 加 disabled。

### H2. SurveyTaskListView "AI 一键批量生成" 是循环 create()
- **前端**: `frontend/src/features/business-module/components/SurveyTaskListView.vue:14, 174-228, 247-254, 343-348`
- **后端**: `backend/application/business-module/survey-task.usecase.ts:181-194` (`batchGenerate`)
- **真相**: 用户面对一个对话框，含 6 条硬编码主题 (`"客户背景信息（人数，年度营业额，组织架构，主营业务）"` 等)。提交后只是循环 `create(projectId, topic, "")` 创建 N 条 `idle` 任务。标题栏 `AI 一键批量生成（基于示例主题）` 误导性极强。
- **影响**: 用户以为 AI 在做规划，实际只是手动批量建空任务。

### H3. SurveyTask 异步执行 = setTimeout + 硬编码模板
- **后端**: `backend/application/business-module/survey-task.usecase.ts:74, 198-247`
- **真相**: 私有方法 `execute()` 走 `await sleep(this.simulateDurationMs)` (800ms)，随后写入：
  ```md
  # 调查：<title>

  主题：<topic>

  （本结果由本地占位逻辑生成，后续阶段接入 survey-researcher sub-agent）
  ```
  前端轮询 (`survey-task.store.ts:155-171` 的 `setInterval(400)`) 显示 transition `running → completed`，配合后端的占位符共同伪造"AI 完成调查"。
- **影响**: 用户标记"已采用"后这些假数据进知识库；`survey-researcher` sub-agent 已注册但未在此处调用。
- **修复方向**: 在 `SurveyTaskUseCase` 构造时注入 `InvokeSubAgentUseCase`，把 `execute()` 改成 `for await (const ev of subAgent.invoke({name:"survey-researcher", input: topic, projectId}))`。

### H4. 11 个 markdown 模块 "AI 生成" 全是模板印章
- **前端按钮**: `frontend/src/features/business-module/components/MarkdownModuleView.vue:36-42, 161-175` (调用 `markdownModuleApi.generate`)
- **后端**: `backend/application/business-module/markdown-module.service.ts:279-289` (`generateContent`)
- **真相**: 把 `KIND_TO_TEMPLATE[kind]` 的硬编码中文模板原样拼装，再追加 `\n\n> 生成时间：…（占位逻辑，待接入 AI sub-agent）\n` 印章。无论项目背景如何，11 个模块（业务现状/痛点/改善/构想/非功能/IT环境/风险/TO-BE/ROI/前提/硬件成本）都返回同一套通用模板。
- **路由注释**: `backend/presentation/routes/markdown-module.route.ts:8` `// AI 占位生成`
- **影响**: 用户在某个模块里辛辛苦苦写了内容，点 "AI 生成" 按钮 → 自己的草稿被模板 + 占位时间戳覆盖。

### H5. 自定义业务模块 "AI 生成" 同样模板印章
- **前端**: `frontend/src/features/business-module/components/CustomPageEditor.vue:38-42, 145-158`
- **后端**: `backend/application/business-module/business-module.service.ts:124-146` (`generatePlaceholder`)
- **真相**: 写出 `# <title>\n\n> 生成时间：…（占位逻辑，待接入 AI sub-agent）\n\n<现有内容或默认占位>`。仅 `kind === "custom"` 时允许触发。
- **路由注释**: `backend/presentation/routes/business-module.route.ts:14` `// AI 占位生成（仅 kind=custom）`

### H6. SurveyQuestionnaire batchFromMindmap 写入 "（占位问题）<path>" 字面量
- **前端**: `frontend/src/features/business-module/components/QuestionnaireView.vue:35-42, 352-364` ("从脑图生成问题")
- **后端**: `backend/application/business-module/survey-questionnaire.usecase.ts:157-181`
- **真相**: 注释 `/** AI 占位：从脑图节点生成问题（每节点 1 条占位问题；阶段 7.x 接 sub-agent 时替换）*/` 明示。遍历脑图树，每节点写入 `title: \`（占位问题）${path}\`` 真的进库。
- **影响**: 用户面对一堆 `（占位问题）行业背景 / 行业背景 / 客户业务` 行；UI 在 `QuestionnaireView.vue:104` 文字 `批量生成占位问题` 部分承认，但操作按钮本身没有禁用 / 警告。

### H7. QuoteUseCase.aiGenerateDraft 必报 INTERNAL
- **后端**: `backend/application/quote/quote.usecase.ts:196-217`
- **真相**: 注释 `// 阶段 7.x 接 sub-agent`，函数本身合法但 `main.ts:369-390` 构造 `QuoteUseCase` 时**没有**注入 `aiGenerateMarkdown` 回调 → 永远走 `domainErr("INTERNAL", "AI sub-agent not wired; aiGenerateMarkdown callback is missing")`。
- **影响**: `.xlsx` 里的 `aiMarkdown` 列永远空。Excel 导出本身是真的 (exceljs)，但 AI 起草部分完全假。
- **修复方向**: 在 `main.ts` 注入 `aiGenerateMarkdown: async (opts) => { ... }`，调用 `subAgentApi.invoke("proposal-drafter", {input: opts.userInput, projectId})` 收集 LLM 输出。

### H8. sub-agent 路径绕过 InvokeSubAgentUseCase
- **后端**: `backend/application/sub-agent/invoke-sub-agent.usecase.ts` 整文件未被 import
- **真相**: `sub-agent.route.ts:83-185` 直接实例化 `ContextAwareSubAgentRunner` + `ToolExecutor` 跑循环。`InvokeSubAgentUseCase.execute(options) → AsyncIterable<StreamEvent>` 是文档化契约但 production 路径忽略它。
- **影响**: use case 后续若加 max-rods 策略 / telemetry / 中心化 ToolExecutor 装配，运行中的服务不会生效；两个并行调用路径在纸面上存在，只有一个实际跑。
- **修复方向**: 在 `sub-agent.route.ts` 改用 `InvokeSubAgentUseCase.execute()`，把循环逻辑下沉。

### H9. dev.ts 装配严重缩水（settings / dashboard / SMTP / read_module 全无）
- **后端**: `dev.ts:213-344` (`createApp` 调用) vs `main.ts`
- **缺漏**:
  - `settingsRoute` (SettingsUseCase, SqliteSystemSettingRepository, SqliteBackedSubAgentRegistry, ConfigurableToolRegistry, LLMClientResolver)
  - `dashboardRoute` (DashboardUseCase)
  - `profileSnapshot` lambda
  - `smtpFactory` 注入 (`MailUseCase` 构造)
  - `readModule` deps → `buildBuiltinToolRegistry`
- **影响**:
  - dev 下 `/api/settings/*` 返 501
  - dev 下 `/api/dashboard/*` 返 501
  - dev 下邮件**永远**走 `.eml` 文件 fallback (即使 settings 表里配了 SMTP 账号)，因为 `this.settings && this.smtpFactory` 永远 false
  - dev 下 `ppt-designer` 和 `business-email-writer` 调 `read_module` 时 500 ("sub-agent references unknown tool: read_module")
  - dev 下 LLM 客户端走简单 `Map<name, ILLMClient>` 缓存 (`dev.ts:87-100`)，不读 settings DB — settings 改了等于没改
- **修复方向**: 把 `main.ts` 的依赖装配抽成一个函数 (`buildAppDeps(config)`)，main.ts 和 dev.ts 都调它。

### H10. DELETE `/api/projects/:id/emails/:eid` 路由硬 405
- **后端**: `backend/presentation/routes/email.route.ts:291-307`
- **真相**: 注释 `// 简化：调用 useCase.deleteEmail —— 不实现的话直接：` 和 `// 为减少接口膨胀，本路由暂不支持删除。` 明示。前端如果点删除按钮，返 405。
- **影响**: API 注释 (`email.route.ts:11`) 宣传 `DELETE …（仅 draft 允许）`，实现硬 405，合约与现实不符。

### H11. `requiresApproval` 完全未生效
- **后端**: `backend/ai/tool/tool-executor.ts:6` 注释 `2. requiresApproval → 本期 stub 直接通过（阶段 6+ 接审批流）`
- **真相**: `executeOne` (35-100 行) 从未读取 `tool.requiresApproval`。所有内置工具声明 `readonly requiresApproval = false`。若未来给 `send_email` 类工具设 `requiresApproval = true`，照样会执行，无任何人类审批环节。
- **影响**: 今天所有内置工具都是只读的，所以是 latent bug；安全承诺完全没落地。
- **修复方向**: 在 `ToolExecutor.executeOne` 入口检查 `tool.requiresApproval && !approved`，抛出 `ApprovalRequiredError` 由 UI 处理。

### H12. search_knowledge 工具硬编码返回空
- **后端**: `backend/ai/tool/builtin/search-knowledge.tool.ts:51-59`
- **真相**: 函数永远返回 `{ hits: [], note: "search_knowledge: ...RAG 召回依赖上下文（injected by ToolExecutor）" }`。无 DB 访问，无向量检索。注释自己承认 "依赖上下文注入"。
- **影响**: 5 个 sub-agent 中 4 个 (`survey-researcher`, `proposal-drafter`, `ppt-designer`, `business-email-writer`) 的 `toolNames` 都引用它。LLM 调用时拿到空 hits。ToolExecutor (`tool-executor.ts`) 实际上**没有**注入任何上下文到 args。
- **修复方向**: 在 ToolExecutor 里调用 `RetrieveUseCase` 把命中 chunks 作为 JSON 注入 tool args；或在 search_knowledge 里直接调用 `RetrieveUseCase`。

---

## MEDIUM 严重度（开发者可见 / 部分缺失）

### M1. vec0 cosine search 完全没实现
- **后端**: `backend/application/knowledge/retrieve.ts:40-52`
- **真相**: 当 `knowledge_vec_status.status === 'loaded'` 时**抛** `INTERNAL` 错误 "vec0 cosine search not yet implemented (planned for 6.0d)"。整个项目没有 `VecKnowledgeChunkRepository` 类 (grep 确认只在 JSDoc 出现)。
- **影响**: 正常流程下 `readVecStatus()` 返 `null` → 默认走 `searchByLike` (substring)，score=0.5 对所有命中。语义相似度 = 0。RAG 沦为字面搜索。
- **修复方向**: 实现 vec0 路径或移除 `VecKnowledgeChunkRepository` 占位声明 + JSDoc。

### M2. Email "send" 在 settings 未配时静默写 .eml
- **后端**: `backend/application/mail/mail.usecase.ts:110-153`
- **真相**: 若 `this.settings || this.smtpFactory` 缺失，fallback 到把 `.eml` 文件写磁盘，日志 `"email sent (mock)"`。路由返 200。
- **影响**: 用户看到 `status=sent` 但邮件未离机。`main.ts:355` 注入了 `smtpFactory`，prod 路径会真发，但 dev 路径（H9 已述）永远走 fallback。
- **修复方向**: 在 settings 未配时返回 `domainErr("BAD_REQUEST", "请先在系统设置中填写发件账号")` 而非静默写文件。

### M3. Embedding provider 缺失时静默降级到 mock
- **后端**: `main.ts:136-168`, `backend/ai/embedding/mock-embedding.provider.ts`
- **真相**: 没 Ollama / 没 OpenAI key / 没 DashScope key 时，factory 抛 `EmbeddingUnavailableError` → catch 后换 `MockEmbeddingProvider` (FNV-1a hash → 确定性但无语义的向量)。仅 `console.warn`。
- **影响**: 知识 ingest 默默用 hash 向量入库，用户毫无感知。RAG 召回会返回语义无关的相似度分数。
- **修复方向**: fail-fast 或用 config flag `embedding.allowMock` 显式 opt-in。

### M4. AutoAdoptFrequentlyCitedUseCase 构造后 void 掉
- **后端**: `main.ts:216-222`, `dev.ts:205-211`
- **真相**: `const autoAdoptUseCase = new AutoAdoptFrequentlyCitedUseCase(...); void autoAdoptUseCase; // 后续启动 background job 调用`。注释自己写"后续启动 background job 调用"，但全代码库搜不到任何 `setInterval` / `cron` / `scheduler` 启动它的地方。
- **影响**: 自动采用常被引用的助手消息（use case docstring 描述的功能）永不执行；知识库增长只能手动。

### M5. PPT route `/api/projects/:id/ppt/pages` 匹配器过宽
- **后端**: `backend/presentation/server.ts:385` `if (path.includes("/ppt/pages") || path.includes("/modules/ppt/pages"))`
- **影响**: 当前没有碰撞路径所以没事，但任何 `/api/.../ppt/pages...` 子串都会路由到 `handlePpt`；未来易踩坑。
- **修复方向**: 改为正则或精确前缀匹配。

### M6. contextWindow / maxOutputTokens 在 main.ts vs dev.ts 不一致
- **后端**: `main.ts:190-196` vs `dev.ts:172-176`
- **真相**: main.ts 用 `Math.max(200_000, profile.maxTokens * 10)`；dev.ts 写死 `200_000` / `8_192`。
- **影响**: 同一 profile 在 prod 和 dev 上下文窗口可能不一致；无法在 config.toml 调。

### M7. PPT 提示模板在两处重复
- **后端**: `backend/application/business-module/ppt.usecase.ts:64-78` 和 `backend/application/sub-agent/builtin-sub-agents.ts:44-58`
- **影响**: 不是 stub，但同一份 `PPT_DESIGNER_SYSTEM` 在两处维护，将来改一处必漏一处。

### M8. EmailComposerDialog "AI 起草" 主题自动填充脆弱 + 静默吞错
- **前端**: `frontend/src/features/project/components/EmailComposerDialog.vue:200, 250, 244-271`
- **真相**:
  - 第 250 行硬编码 `"请按商务风格起草一封给客户的邮件正文（3~5 段；先写占位主题）"` 作为无主题时的回退指令。
  - 第 200 行 `console.warn("load project for email defaults failed", e)` 静默吞错；TO/CC 变空但用户无任何提示。
- **影响**: SSE 调用本身真 (`subAgentApi.invoke("business-email-writer")`)，但 prompt 僵化；agent 未配置时用户只看到 `error: …`。

### M9. QuoteAiDraftDialog 800ms setTimeout 假加载
- **前端**: `frontend/src/features/quote/components/QuoteAiDraftDialog.vue:103-109`
- **真相**:
  ```ts
  emit("generate", { templateId: templateId.value, userInput: userInput.value });
  setTimeout(() => { busy.value = false; }, 800);
  ```
  注释承认 `本阶段 AI 起草未接线 → 仅占位`；800ms 是伪装调用延迟。
- **影响**: 产生的 `.xlsx` 是真的 (exceljs + 真实 snapshot + hardware items)，只是 "AI 起草" 框架是假的。

---

## LOW 严重度（内部 / 死代码 / 文案不一致）

### L1. Stub Provider 类在源码树死路径
- `backend/ai/context/providers/stub-providers.ts:28-46` — `StubProjectSnapshotProvider` / `StubRagProvider` 抛 `NotImplementedProviderError`。main.ts 没 import，但文件存在可被引入。

### L2. SqliteSubAgentRegistry 用 module-level Map 缓存
- `backend/persistence/sqlite/sqlite-sub-agent-registry.ts:27, 58-68` — `syncCache: Map<string, SubAgentSpec>`；只有 main.ts 启动后调一次 `refreshSyncCacheAsync`，之后 settings 改了缓存不一定刷新（footgun）。

### L3. read_module 工具 module provider 未注册
- `backend/ai/tool/builtin/read-module.tool.ts:161-178` — `registry.getModule(moduleName)` 永远找不到 (main.ts 只 register 了 rag/project provider)，最终走 `projProvider.summarize` fallback。能用但不优雅。

### L4. server.ts close() 是 no-op
- `backend/presentation/server.ts:441-443` — `async close() { // 后续阶段挂 database.close() }` — DB handle 不关，长跑进程会泄漏 SQLite WAL / FD。

### L5. 多个路由末尾的 "not implemented" 404 文案误导
- `business-module.route.ts:275`, `structured-modules.route.ts:300`, `budget.route.ts:94`, `dashboard.route.ts:74`, `markdown-module.route.ts:112`, `survey-questionnaire.route.ts:179`, `ppt.route.ts:222`, `server.ts:433`
- 消息 "route X not implemented" 对合法路由 bug (typo 等) 误导。应是 "NOT_FOUND" 而非 "not implemented"。

### L6. SqliteAiSessionRepository.save 删旧全插 (低效)
- `backend/persistence/sqlite/sqlite-ai-session.repository.ts:155-156` — "删旧 messages 重写（聚合根一个事务，简化策略；后续优化用 diff）"

### L7. exceljs-filler byModule / byPhase 行级块永远空
- `backend/application/quote/exceljs-filler.ts:186-187` — `blocks[0].rows = []; blocks[1].rows = [];` — 即使模板定义了 BEGIN/END byModule / byPhase，也产生零行。

### L8. ProjectListView 用 window.alert
- `frontend/src/features/project/components/ProjectListView.vue:106, 121` — `alert(e.message)`；项目内其他地方用 inline `<p class="text-xs text-red-300">`，不一致。Cosmetic only。

### L9. StatCard.vue 注释 "占位" 过期
- `frontend/src/features/dashboard/components/StatCard.vue:4` 注释 `// 仪表盘统计卡片占位` — 组件本身渲染真实数据，注释过期。

---

## 真实功能确认（PASS 表）

| 模块 | 关键文件 | 状态 |
|---|---|---|
| LLM 流式 (Anthropic + OpenAI) | `backend/ai/transport.sdk.ts`, `client/anthropic.client.ts`, `client/openai.client.ts` | ✅ 真实 |
| SSE 流式 / 多轮 sub-agent | `backend/ai/sub-agent/sub-agent-runner.ts`, `context-aware-runner.ts` | ✅ 真实 |
| Tool 执行 (list_files / read_file / current_datetime / read_module) | `backend/ai/tool/tool-executor.ts`, `builtin/*.tool.ts` | ✅ 真实 (search_knowledge ❌ stub) |
| SQLite 迁移 + 持久化 | `backend/persistence/database/migrations/001-010`, `sqlite/*.repository.ts` | ✅ 真实 |
| ExcelJS 导出 | `backend/application/quote/exceljs-filler.ts` | ✅ 真实 |
| PPT JSON 解析 + DB 持久化 | `backend/application/business-module/ppt.usecase.ts` | ✅ 真实 (LLM 调用 + JSON parse + 入库) |
| SMTP 邮件传输 | `backend/infrastructure/mail/smtp-transport.ts` | ✅ 真实 (Deno.startTls + SMTP 命令 + MIME) |
| OpenAI / DashScope / Ollama embedding | `backend/ai/embedding/*.provider.ts` | ✅ 真实 (HTTP fetch) (⚠️ 缺失时降级到 mock) |
| 仪表盘聚合 | `backend/application/dashboard/dashboard.usecase.ts` | ✅ 真实 (SQL COUNT/GROUP BY) |
| Knowledge ingest / chunking | `backend/application/knowledge/ingest-project.usecase.ts` | ✅ 真实 |
| 5 个 builtin sub-agent 注册 | `backend/application/sub-agent/builtin-sub-agents.ts`, `sqlite-sub-agent-registry.ts` | ✅ 真实 (seed 进 settings DB) |
| 商务邮件 AI 起草 | `EmailComposerDialog` → `subAgentApi.invoke("business-email-writer")` | ✅ 真实 |
| PPT 大纲 AI 生成 | `PptAiGenerateDialog` → `ppt.usecase.generatePages` | ✅ 真实 |
| AI 对话 (主助手) | `ai-chat.store.ts:35-132` → `aiChatApi.streamChat` | ✅ 真实 |
| 拖拽排序 (PPT pages) | `PptView.vue` vuedraggable + `pptApi.reorder` | ✅ 真实 |
| 脑图拖拽 / 缩放 / 撤销 | `vue3-mindmap` 第三方库 | ✅ 真实 |
| 客户端导出 (CSV / MD) | `URL.createObjectURL + Blob` | ✅ 真实 (浏览器内序列化) |
| 邮件附件上传 | `emailApi.uploadAttachment` (FormData) | ✅ 真实 |
| Settings 持久化 | `settings.api.ts` + 后端 settings.usecase | ✅ 真实 (含冲突检测、唯一名校验) |
| 仪表盘统计 | `DashboardView.vue` + `dashboard.store.ts` | ✅ 真实 (SQL 聚合) |

---

## 修复优先级建议

| 优先级 | 项 | 工作量 | 影响 |
|---|---|---|---|
| 🔴 P0 | H7 注入 `aiGenerateMarkdown` 到 QuoteUseCase (`main.ts:378-388`) | XS (10 行) | 报价 AI 列真正可用 |
| 🔴 P0 | H8 把 sub-agent route 切到 InvokeSubAgentUseCase | S (30 行) | 让 use case 成为唯一路径，未来加策略不漏 |
| 🔴 P0 | H12 让 ToolExecutor 给 search_knowledge 注入 RAG 命中 | M (50 行) | 4/5 个 sub-agent 不再"空跑" |
| 🟠 P1 | H3 把 SurveyTask.execute 改用 survey-researcher | M (60 行) | 调查任务真 AI |
| 🟠 P1 | H4+H5+H6 把 markdown-module / business-module / batchFromMindmap 改用对应 sub-agent | L (每个 60-80 行) | 11 个模块 + 自定义页 + 问卷批量生成真 AI |
| 🟠 P1 | H9 把 dev.ts 装配补齐 (settings / dashboard / smtpFactory / readModule) | M (80 行) | dev 与 prod 行为一致 |
| 🟠 P1 | H11 ToolExecutor 加 requiresApproval 检查 | S (20 行) | 未来加 send_email 类工具安全 |
| 🟡 P2 | H10 实现或删除 DELETE email route | XS (5 行) | API 合约对齐 |
| 🟡 P2 | M1 实现 vec0 cosine | M | RAG 语义搜索真正生效 |
| 🟡 P2 | M2 Email settings 未配返错而非写 .eml | XS | 用户感知 |
| 🟡 P2 | M3 Embedding 降级加 config opt-in | S | 用户感知 |
| 🟡 P2 | M4 AutoAdopt 接 setInterval (e.g. 1h) | S | 知识库自动滚动 |
| 🟡 P2 | M8 QuoteAiDraftDialog 800ms setTimeout → 真调 subAgent | S | 报价 AI 起草真 AI |
| 🟢 P3 | L1 删除 stub-providers.ts 死文件 | XS | 死代码清理 |
| 🟢 P3 | L3 read_module module provider 注册 | S | 路径一致 |
| 🟢 P3 | L4 server.close 真正关 DB | XS | 长跑进程不漏 FD |
| 🟢 P3 | L5 404 文案改 "NOT_FOUND" | XS | 调试友好 |
| 🟢 P3 | M5 PPT route 匹配器改正则 | XS | 防 latent bug |
| 🟢 P3 | M6 contextWindow 抽 config | S | 配置一致 |
| 🟢 P3 | M9 EmailComposerDialog 静默吞错改为 inline 提示 | XS | 用户感知 |
| 🟢 P3 | L8 ProjectListView alert 改 inline | XS | UX 一致 |
| 🟢 P3 | L9 StatCard 注释清理 | XS | 文档整洁 |

---

## 关键文件清单 (绝对路径)

### HIGH
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/business-module/components/FunctionListView.vue`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/business-module/components/SurveyTaskListView.vue`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/business-module/components/MarkdownModuleView.vue`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/business-module/components/CustomPageEditor.vue`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/business-module/components/QuestionnaireView.vue`
- `/home/rococo/ai-presales/ai-presales/backend/application/business-module/survey-task.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/business-module/markdown-module.service.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/business-module/business-module.service.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/business-module/survey-questionnaire.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/quote/quote.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/sub-agent/invoke-sub-agent.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/ai-presales/dev.ts`
- `/home/rococo/ai-presales/ai-presales/backend/presentation/routes/email.route.ts`
- `/home/rococo/ai-presales/ai-presales/backend/ai/tool/tool-executor.ts`
- `/home/rococo/ai-presales/ai-presales/backend/ai/tool/builtin/search-knowledge.tool.ts`

### MEDIUM
- `/home/rococo/ai-presales/ai-presales/backend/application/knowledge/retrieve.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/mail/mail.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/ai-presales/main.ts`
- `/home/rococo/ai-presales/ai-presales/backend/ai/embedding/mock-embedding.provider.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/ai/auto-adopt-frequently-cited.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/backend/presentation/server.ts`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/project/components/EmailComposerDialog.vue`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/quote/components/QuoteAiDraftDialog.vue`
- `/home/rococo/ai-presales/ai-presales/backend/application/business-module/ppt.usecase.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/sub-agent/builtin-sub-agents.ts`

### LOW
- `/home/rococo/ai-presales/ai-presales/backend/ai/context/providers/stub-providers.ts`
- `/home/rococo/ai-presales/ai-presales/backend/persistence/sqlite/sqlite-sub-agent-registry.ts`
- `/home/rococo/ai-presales/ai-presales/backend/ai/tool/builtin/read-module.tool.ts`
- `/home/rococo/ai-presales/ai-presales/backend/persistence/sqlite/sqlite-ai-session.repository.ts`
- `/home/rococo/ai-presales/ai-presales/backend/application/quote/exceljs-filler.ts`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/project/components/ProjectListView.vue`
- `/home/rococo/ai-presales/ai-presales/frontend/src/features/dashboard/components/StatCard.vue`

---

## 总结

整个项目在 **基础设施层** (LLM/SMTP/SQLite/SSE/ExcelJS/Embedding) 投入扎实，5 个 sub-agent 定义清晰，PPT + 商务邮件 AI 两条路是真实可用的。

但在 **应用层**，至少有 7 个核心 AI 功能 (FunctionList 生成、SurveyTask 批量 + 执行、11 个 markdown 模块 + 自定义页 + 问卷批量、Quote AI 起草) 是显式占位。它们的共同模式：
- 后端注释必含 `占位逻辑`、`待接入 AI sub-agent`、`本期未接线`
- 路由注释 `AI 占位生成`
- 前端按钮标签部分诚实 (`AI 生成（占位）`)，但其他对话框标题 (`AI 一键批量生成（基于示例主题）`) 有意含糊

**两类系统性问题**:
1. **DI 不全** — `dev.ts` 缺失 `settingsRoute` / `dashboardRoute` / `smtpFactory` / `readModule` deps / `LLMClientResolver`，导致 dev 与 prod 行为分歧
2. **InvokeSubAgentUseCase 是死路径** — 定义了但没人 import；`sub-agent.route.ts` 直接内联 `ContextAwareSubAgentRunner` 跑循环，所有要"接 sub-agent"的占位功能都没统一入口

**最低成本 / 最高影响的 3 步起步**:
1. H7: `main.ts` 把 `aiGenerateMarkdown` 注进 `QuoteUseCase` (~10 行)
2. H12: `ToolExecutor` 给 `search_knowledge` 注入 `RetrieveUseCase` 结果 (~50 行)
3. H8: `sub-agent.route.ts` 切到 `InvokeSubAgentUseCase.execute()` (~30 行)

—— 这 3 步完成后，RAG 全链路通、报价 AI 列可用、sub-agent 路径唯一，为后续 H3/H4/H5/H6 替换占位模板铺好脚手架。

---

**审计人员**: Claude (3 个并行 Explore agent + 主对话综合)
**未修改代码**: 本次审计为只读分析，所有发现仅文档化。