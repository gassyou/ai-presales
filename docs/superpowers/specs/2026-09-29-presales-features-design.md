# ai-presales 13 项功能补完 — 设计 Spec

> 日期：2026-09-29
> 作者：Claude（与产品协作）
> 路径：`docs/superpowers/specs/2026-09-29-presales-features-design.md`
> 状态：**Draft — 待评审**

本 spec 覆盖用户列出的 13 个功能项。仓库已部分实现的部分会在每节明确标注 "已实现 / 待补完 / 新增"。所有改动遵循现有 DDD 分层（`domain/` → `application/` → `persistence/` → `presentation/` + 前端 Vue/Pinia）。

---

## 0. 总览 & 实施切片（task list）

将 13 项切成 9 个独立可提交的 PR；每 PR 独立 review / merge：

| PR | 标题 | 关联用户项 | 估算 LOC |
|---|---|---|---|
| **#1** | 项目状态：中止 + won/lost 字段补全 | #1 | ~250 |
| **#2** | 项目工作区（创建 / 路径） | #2 | ~500 |
| **#3** | Sub-agent 类型（system / user） + UI | #3 | ~400 |
| **#4** | Chat 会话：手动新建 + 持久化 | #4, #5 | ~600 |
| **#5** | Chat skill 系统：路由 + slash 命令 | #6 | ~700 |
| **#6** | Chat composer 改造（删 sub-agent / chat-agent 切换，改 model selector） | #7, #9, #11 | ~350 |
| **#7** | Chat 附件上传 + AI 解析 | #8 | ~450 |
| **#8** | Chat「全自动」开关 + UI | #12 | ~250 |
| **#9** | Auto-mode 全功能流水线（8 sub-agent + 双 review） | #13 | ~1800 |

合计 ≈ 5300 LOC（含测试）。估算 5–7 工作日。

---

## 1. 项目状态：中止 / 中标 / 未中标 字段补全（用户项 #1）

### 状态
**已实现 60%** — 中标 / 未中标字段 + 必填校验、`markWon/markLost/markPaused` 方法、`paused_date` 列都已就位。**缺**：将 `paused_date` 改名为更精确的语义 + 增加 "中止" 状态的字段约束 + 前端 UI。

### 现状摘要
- `ProjectStatus` 已包含 `"中止"` 状态；状态机允许 `提案中 → 中止` 和 `暂停 → 中止`。
- `paused_date` 列与 `pauseReason` 列已经存在；但 `markPaused` 写入的是 `pauseReason`，而**中止**需要单独的 `abortedDate` + `abortReason` 字段，UI 没有这一项。
- 前端 `ProjectDetailView` 没有"中止"按钮。

### 改动清单

#### Backend

1. **migration `015_project_aborted.sql.ts`**（命名遵循 012/014 模式；id 也用 `015`）
   ```sql
   ALTER TABLE projects ADD COLUMN aborted_date TEXT;
   ALTER TABLE projects ADD COLUMN abort_reason TEXT;
   ```

2. **`backend/domain/project/project.ts`**
   - 在 `ProjectSnapshot` 增加 `abortedDate: Date | null`、`abortReason: string | null`。
   - 在 `Project` 私有字段、`init` 对象、`rehydrate` 方法、`create` 方法、`snapshot` getter 同步加这两个字段（保持 null = 旧数据兼容）。
   - 新增方法 `markAborted({ abortedDate: Date; abortReason: string }, clock)`：
     - 校验当前状态 ∈ {`提案中`, `暂停`}；
     - 校验 `abortedDate` 合法，`abortReason` 非空；
     - 走 `ProjectStatus.transition("中止")`，写入日期 + 原因；
     - 触发 `ProjectStatusChangedEvent`，`reason = abortReason`。
   - `ProjectService.changeProjectStatus` 路由：target=`"中止"` → `markAborted`。

3. **测试**：`backend/domain/project/project.test.ts` 增加 `markAborted` 单测（合法/非法跳转、字段必填、事件触发）；`backend/application/project/*` 集成测试加一例。

#### Frontend

1. **`frontend/src/features/project/ProjectDetailView.vue`**
   - 在"状态切换"区增加"中止"按钮（仅在状态为"提案中"或"暂停"时显示）。
   - 点击 → `el-dialog` 输入"中止日期"（`el-date-picker`）+ "中止原因"（`el-textarea`，`required`）。
   - 调用 `changeProjectStatus` mutation，body 加 `abortedDate` + `abortReason`。
2. **store**：`projects.store.ts` 的 `changeProjectStatus` 接受新增字段；调用 `api.changeProjectStatus({ target, abortedDate?, abortReason? })`。
3. **DTO**：`shared/types/dto/project.ts` 增加 `abortedDate: string | null` / `abortReason: string | null`。

### 测试
- 单测：domain 层 5 例（合法跳转/非法跳转/字段空校验）；前端无单测仅手测。

---

## 2. 项目工作区（用户项 #2）

### 状态
**已实现 70%** — `workspace_path` 列、`snapshot` getter、字段读取都已就位；`auto-mode` 已用此字段。**缺**：写工具（设置/解析/创建）+ 前端 UI。

### 改动清单

#### Backend

1. **新工具 `set_project_workspace`**（写入型 tool）
   - 入参：`{ projectId: string, workspacePath: string, createIfMissing: boolean }`
   - 校验：
     - `workspacePath` 是绝对路径（`/foo` 或 `~/foo`），否则 `INVALID_INPUT`；
     - 解析 `~` → `Deno.env.get("HOME") ?? os.homedir()`。
   - 行为：
     - 若 `createIfMissing = true` 且 `lstat` 不存在 → `mkdir(path, { recursive: true })`；父目录不存在递归创建；
     - 写失败（权限）→ `TOOL_ERROR`。
   - 写后通过 `ProjectService.setWorkspacePath(projectId, absolutePath, clock)` 落库（新增应用层方法）。
   - 返回：`{ ok: true, resolvedPath: "/abs/path" }`。

2. **新工具 `resolve_project_workspace`**（只读）
   - 入参：`{ projectId: string }`
   - 行为：从仓储读 `workspacePath`；
     - 若为空 → 返回 `{ resolvedPath: "<HOME>/Desktop/<projectCode>", source: "default", exists: boolean }`；
     - 若非空 → 返回 `{ resolvedPath: <path>, source: "stored", exists: boolean }`。
   - 不创建。

3. **`Project.setWorkspacePath(absPath: string, clock)`**（domain 方法）
   - 校验 absPath 非空字符串；
   - 触发 `ProjectWorkspaceChangedEvent`（新增）携带 before / after / source。

4. **`backend/application/project/project.service.ts`**
   - 新增 `setWorkspacePath({ projectId, absolutePath, createIfMissing })`：调 domain 方法 + 落库 + 写一条 activity（"工作区已设置到 <path>"）。

5. **新 migration `016_project_workspace_tool.sql.ts`**（无 schema 改动；只是版本占位）—— 跳过；本节无新表。

#### Frontend

1. **`ProjectDetailView.vue`**：在 "项目元信息" 区增加 "工作区路径" 输入框 + "选择" 按钮（打开 `el-dialog` 内置 `fs-readdir` 选目录；选用平台 dialog 较复杂，先用 `<input type="text">` + "自动补全"按钮：在前端用 `window.showDirectoryPicker` 不可用时改为后端调 `read_module` 类似路径选择器，简化为一个文本框 + "使用默认（桌面 + 项目编号）" 按钮）。
2. **store**：`setWorkspace({ projectId, path, createIfMissing })` → `api.setProjectWorkspace(...)` → refresh。
3. **DX**：默认桌面路径的获取走后端 `resolve_project_workspace`（前端不假设平台 `getDir`）；前端在初始化项目时调用一次 `resolve` → 展示默认值。

### 测试
- 单测：`set_project_workspace` 用 `Deno.makeTempDir` + 在临时目录创建；`resolve_project_workspace` 覆盖 null / 已存在 / 不存在三种。

---

## 3. Sub-agent 类型（system / user） + UI（用户项 #3）

### 状态
**已实现 80%** — `SubAgentSpecVO` 已经有 `type: "system" | "user"`、`type: "system"` 不可改名的 UI 已部分存在。**缺**：路由/服务层的"系统 vs 用户"管理方法 + UI 分组展示 + 新增 / 删除。

### 改动清单

#### Backend

1. **`backend/persistence/sqlite/sqlite-sub-agent-registry.ts`**
   - 当前 `system` 不可改 name / 删除 → 需要新方法：
     - `createUserSpec(input: SubAgentSpecData): DomainResult<SubAgentSpecVO>`：写入 DB；name 唯一校验；type 强制 `"user"`（忽略调用方传入）。
     - `deleteUserSpec(name: string): DomainResult<void>`：name 不存在 → `NOT_FOUND`；type === "system" → `ILLEGAL_OPERATION`；其他校验通过 → DELETE。
     - `updateUserSpec(name, patch)`：同上，type=system 不可改。
   - 这些方法挂在 registry 的"persistence adapter"层；上层 use case 调它们。

3. **`backend/presentation/routes/settings.route.ts`**
   - 已有 `sub-agents` 子路由（推测）→ 增 3 个端点：
     - `POST /api/settings/sub-agents`（body: `{ name, displayName, description, systemPrompt, toolNames, profileHint? }`）→ createUserSpec。
     - `PUT /api/settings/sub-agents/:name`（body: patch）→ updateUserSpec；type=system 路径下 PUT 拒绝（只允许更新 displayName / description）。
     - `DELETE /api/settings/sub-agents/:name` → deleteUserSpec；type=system 返回 403。
   - 列表接口已存在 → 验证返回字段含 `type`，无需改。

#### Frontend

1. **`frontend/src/features/settings/components/SubAgentManager.vue`**（新建）
   - Tab 拆分：
     - **系统 sub-agent**（disabled 卡片，hover 显示 "系统内置，不可删除"）
     - **用户 sub-agent**（每条卡片有 "编辑 / 删除" 按钮；删除二次确认）
   - 顶部 "+ 新增用户 sub-agent" 按钮 → 弹 `el-dialog` 表单：
     - name（必填，校验 `^[a-z][a-z0-9_-]{2,63}$`，实时提示）
     - displayName、description、systemPrompt（textarea 8 行）
     - toolNames（多选下拉，选项来自 `tool-registry.names()`）
     - profileHint（可选）
   - 提交调 `createUserSpec`；刷新列表。

2. **`stores/sub-agent.store.ts`**：
   - `items` 已有；增加 `create(payload)`、`remove(name)`、`update(name, patch)`；乐观更新 + 失败回滚。

### 测试
- 单测：registry 持久化层 create/delete/update；system spec 删除/改名返回 ILLEGAL_OPERATION；route 集成 6 例（POST 成功 / name 冲突 / PUT system 拒绝 / DELETE system 403 / DELETE user 成功 / 字段校验）。

---

## 4. Chat 会话：手动新建 + 持久化（用户项 #4 + #5）

### 状态
**已实现 70%** — 后端 `ChatSession` 聚合 + `SqliteChatSessionRepository` + `ChatSessionUseCase` + `/api/chat/sessions` REST 都已就位。**缺**：前端 ai-chat 面板调用会话 API + 会话切换 UI + session 与项目绑定。

### 改动清单

#### Backend

1. **chat-session 已完成** —— 仅在路由层 `handleChatSession` 已实现；无需新代码。**可能微调**：在 `appendMessage` 端点校验 `sessionId` 存在 → 已实现。
2. **ai chat route**：当前用 `ai-session`（独立模型）作为"对话会话"——**关键决策**：把 ai-chat 的 session 从 `AiSession` 切到 `ChatSession`（更薄、更纯消息存储），保留 `AiSession` 用于"AI 主动提议采纳"等高级特性。

#### Frontend

1. **`frontend/src/features/ai-chat/stores/chat-session.store.ts`**（新建）
   - 状态：`currentSessionId: string | null`、`sessions: ChatSessionDTO[]`、`messages: ChatMessage[]`。
   - actions：
     - `loadSessions(projectId)`：GET `/api/chat/sessions?projectId=...` → 填充 `sessions`。
     - `createSession(title?)`：POST `/api/chat/sessions` body `{ projectId, title }` → 插入 sessions。
     - `switchSession(sessionId)`：GET `/api/chat/sessions/:id/messages` → 替换 `messages`。
     - `deleteSession(sessionId)`：DELETE → 列表移除；若是 current 则切回 default（无 session，发送时新建）。
     - `appendMessage(msg)`：乐观写 store + POST 持久化；失败回滚。

2. **`AiChatPanel.vue`**：顶部加 "会话下拉" + "+" 按钮
   - 下拉显示当前项目的 sessionList（每项 title + updatedAt）；
   - "+" 调 `createSession("新对话")`，自动切到新会话。
   - 当前 store 的"消息列表"由 `chat-session.store` 接管；原 `useAiChatStore.messages` 改为 derived getter。

3. **`ChatComposer.vue`**：发送消息时若 `currentSessionId` 为空 → 自动 `createSession`；调流式端点的同时把 `sessionId` 加进 SSE request header（让后端持久化 streaming 输出）。

4. **新 store wire-up**：在 `ProjectDetailView` 加载时调 `chat-session.store.loadSessions(currentProject.id)`；离开时 `switchSession(null)`。

### 测试
- 后端：现有 chat-session 单测已覆盖。**前端**：仅手测 + 一例 Vitest 验 store action（create / switch / delete）。

---

## 5. Chat skill 系统补完（用户项 #6）

### 状态
**已实现 20%** — `Skill` 接口 + `SkillRegistry` 已有 + 默认注册 `skill_list_skills` / `skill_echo`。**缺**：路由接入、LLM 调用 skill、slash 命令前端。

### 改动清单

#### Backend

1. **`backend/presentation/routes/skill.route.ts`**（新建）
   - `GET /api/skills`：返回 `{ items: Array<{ name, displayName, description, inputSchema }> }`。
   - `POST /api/skills/:name/invoke` body `{ args: object }` → 调 `SkillRegistry.execute(name, args, ctx)`；返回 `{ ok: true, output: string }` 或 `{ ok: false, error: string }`。

2. **`backend/ai/skill/builtin-skills.ts`**（新建，默认注册 4 个）
   - `skill_list_skills`：返回 registry 全部（除自身）的简表；
   - `skill_summarize_project`：读项目全部 markdown 模块 → 调 LLM 生成 5 段总结；
   - `skill_draft_email`：基于 `markdown_business_current` + 项目元信息 → 生成邮件草稿；
   - `skill_status_check`：JSON 返 `{ chat_sessions: N, business_modules: N, ... }`；
   - 命名约定 `skill_*` 前缀；与 tool name 不冲突（toolRegistry 同样约定 tool_* 前缀）。

3. **`backend/ai/chat/chat-stream.ts`（阶段 3 已有）**
   - 在 system prompt 注入 skills 描述（与 tools 同样的 XML/JSON 块）；
   - 当 LLM 输出 `{"call_skill": {...}}` → 调 `skill.execute` → 把结果以 `use "skill"` tool-call 形式追加到 messages；
   - `main.ts` 在 DI 阶段调 `SkillRegistry.register(skillListSkills())` 等。

#### Frontend

1. **`ChatComposer.vue`**：textarea 输入 `/` 触发 slash 命令弹窗
   - 输入框 `onInput` 时若最后字符是 `/`（且不在 mention 中）→ 调 `store.loadSkills()` 拉取 → 弹 `<SlashCommandPopover>`：
     - 列表项显示 `name` + `description`；
     - 上下键 / Enter 选中 → 把 `/<name> ` 插入到 textarea 光标后；
     - Escape 关闭。
   - 提交时若首段匹配 `^/(skill_\w+)(?:\s+(.*))?$` → 不走 chat 端点，直接调 `POST /api/skills/:name/invoke` body `{ args: parsedArgs }`，把结果作为一条 `assistant` 消息插入；后续 LLM 不会介入。
2. **`stores/skills.store.ts`**（新建）：`items: SkillSummary[]`、`load()`、`invoke(name, args)`。

### 测试
- skill route 集成 4 例；builtin skill 各 2 例；slash command 解析 3 例（regex / input / 不在 mention 中）。

---

## 6. Chat composer 改造（用户项 #7 / #9 / #11）

### 状态
**已实现 50%** — ChatComposer 已有 profile 下拉（fast/deep/local）和 sub-agent picker 和 tools 开关。**缺**：删除 sub-agent picker / 删除 chat-vs-agent 切换、把 profile 下拉改为 model selector（LLM profiles 来自 settings）。

### 改动清单

#### Backend

1. **`backend/presentation/routes/settings.route.ts`**：已有 `/api/settings/llm-profiles`（推测）。验证返回 `{ profiles: Array<{ id, label, provider, model, ... }> }`。

#### Frontend

1. **`ChatComposer.vue`**：
   - **删除**：`<SubAgentPicker>` 元素整段删除；
   - **删除**：「🛠 工具」/「💬 纯聊」切换按钮整段删除（默认 agent 模式）；
   - **改造**：`<el-select>` `profiles` 数组从硬编码改为 `llmProfiles`（来自 settings store），label 用 `${label} (${model})`，value 用 profile id。
2. **`stores/llm-profiles.store.ts`**（新建）：`load()` → 缓存 profiles。
3. **slash 命令补全**：`/agent <name>` —— 仍然支持按需切换（不在 UI 暴露，slash 触发）；`/use <tool>` —— 仅在高级模式下使用。slash 解析在 `chat-session.store` 里实现。

### 测试
- Vitest：1 例验 profile 列表 + 1 例验 slash `/agent <name>` 解析。

---

## 7. Chat 附件上传 + AI 解析（用户项 #8）

### 状态
**未实现** — Composer 注释明确说"附件 icon 已删除"；底层 backend 没有 attachment 工具。

### 改动清单

#### Backend

1. **新工具 `attach_file_to_chat`**
   - 入参：`{ sessionId: string, fileName: string, contentBase64?: string, contentText?: string, mimeType: string }`
   - 行为：
     - 校验 size ≤ 10 MB；
     - 写入 `~/.ai-presales/data/chat-attachments/<sessionId>/<uuid>.<ext>`；
     - 在 `chat_messages` 表新增一条 role=`user` 的特殊消息 `{"attachments": [...]}`（schema 用 JSON 列扩展）；
     - 触发解析：调 LLM 用一段 prompt "请总结附件 <fileName> 的核心内容并提取关键实体" → 把结果以 `tool_call` 形式追加到 messages。
   - 持久化：metadata 存 `chat_attachments` 新表，PK uuid，FK session_id。
2. **migration `017_chat_attachments.sql.ts`**：
   ```sql
   CREATE TABLE chat_attachments (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
     file_name TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     storage_path TEXT NOT NULL,
     parsed_summary TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX idx_chat_attachments_session ON chat_attachments(session_id, created_at DESC);
   ```
3. **SSE 流式附件预览**：附件上传后实时在 UI 展示 "AI 正在解析..." → 完成后渲染 summary 卡片。

#### Frontend

1. **`ChatComposer.vue`**："⊕" 按钮（目前占位）→ 改为 `<input type="file" multiple>`（hidden），button click 触发；
   - 选择后 `file.arrayBuffer()` → 转 base64；
   - 调 `attach_file_to_chat` → 显示 "上传中" spinner → 完成后展示附件卡片（filename + size + "解析结果"折叠面板）。

### 测试
- 上传一个 txt 文件 → 验证写文件 + chat_attachments 行 + 流解析调一次。

---

## 8. Chat 全自动开关（用户项 #12）

### 状态
**未实现** — 后端没有"全自动"概念；auto-mode 是单独端点，需要开关把它集成进 chat。

### 改动清单

#### Backend

1. **`AiSession` 增加字段 `autoMode: boolean`**（migration `018_ai_session_auto_mode.sql.ts`：ALTER TABLE ai_sessions ADD COLUMN auto_mode INTEGER NOT NULL DEFAULT 0）。
2. **chat stream route**：当 `body.autoMode === true` 时：
   - 调 `AutoModeOrchestrator.run(buildDefaultAutoModePlan(projectId))`；
   - 把每个 task 的 output 作为一条 `assistant` 消息追加到 session；
   - SSE event kind 区分 `chat_chunk` / `auto_task_progress` / `auto_task_pass` 等；
   - 全部任务通过 → store autoModeCompletedAt = now。

#### Frontend

1. **`ChatComposer.vue`**：右上角加 `<el-switch v-model="autoMode" active-text="🤖 全自动" inactive-text="💬 助手" />`。
2. **store**：`autoMode: boolean`；发送时若开 → request body `{ autoMode: true }`；前端渲染 auto-mode 进度（task_start / task_review / task_pass / task_fail）作为特殊 message bubble。

### 测试
- 后端：orchestrator run 单测已有；新增 1 例验 autoMode=true 时 SSE 输出顺序。

---

## 9. Auto-mode 全功能流水线（用户项 #13）

### 状态
**已实现 30%** — 5 个 spec（env-init / business-req / survey-task / customer-review / director-review）+ orchestrator 接口 + default-context-provider + worker stub + reviewer stub + `/api/ai/auto-mode` 端点都已就位。**缺**：4 个剩余 sub-agent spec（业务架构 / 技术架构 / 功能清单 / PPT 设计师）、worker 真实实现（现是 stub）、reviewer 真实实现、context provider 接通、review 平均分通过判断（orchestrator 已有 threshold）、round 重试逻辑。

### 改动清单

#### Backend

1. **`backend/ai/auto-mode/auto-mode-agents.ts`** 新增 4 个 spec（每个约 80–120 行 prompt）：
   - `auto_business_arch` —— 业务架构专家；工具 `read_module`, `update_markdown_module`, `update_use_case`, `update_function_list`；prompt 含：核心用例设计 5–8 个（标题 / 角色 / 前置 / 主流程 / 异常 / 后置）、TO-BE 蓝图（Markdown）、ROI（投入 / 收益 / 回收期）、交付物清单（每项名称 / 类型 / 责任人 / 时间）。
   - `auto_tech_arch` —— 技术架构专家；工具同上；prompt 含：方案设计（业务角色 + 业务流程图 mermaid + 关键业务模块 + 业务规则 + 业务数据分析 + 流程图）、非功能需求（性能 / 安全 / 可用性 / 可扩展）、IT 环境 + 硬件清单 + 前提条件 + 风险矩阵（5×5 likelihood × impact）。
   - `auto_feature_list` —— 系统功能分析专家；工具 `read_module`, `update_function_list`；prompt 含：选定一个最简单的功能点 CP=1；其他功能点与该点对比按斐波那契（1, 2, 3, 5, 8, 13, 21）；每条记录：大分类 / 模块 / 功能名 / 功能详情（涉及的数据对象属性 + 业务规则：每条规则换行）/ CP 值 / 备注。
   - `auto_ppt_designer` —— 提案 PPT 专家；工具 `read_module`, `update_ppt_pages`；prompt 含：每页内容（含目标受众 / 视觉风格 / 关键要点 / 配图）+ 风格映射（保守商务 / 极简 / 高对比）；调 `generatePpt(pages, theme)` 写 PPT store。

3. **`backend/ai/auto-mode/sub-agent-worker.ts`** —— 真实 worker
   - 替换 stub：从 `ISubAgentRegistry.get(subAgentName)` 取 spec → 构造 LLM prompt（systemPrompt + context 输入 + feedback 描述）→ 调 chat client → parse output：
     - 若 spec 含 `outputSchema` → 用 `zod`-like parser（自写轻量）校验；
     - 若 spec 工具列表含 `update_markdown_module` → 解析 markdown sections，按 `kind` 分别调对应 use case 写入；
     - 其他按 spec 类型特判。
   - 输出 `{ output: string, wroteModules: ContextInputKind[] }`。

4. **`backend/auto-mode/sub-agent-reviewer.ts`** —— 真实 reviewer
   - 同样从 registry 取 review spec，调 LLM；parse 出 `scores` / `average` / `feedback`；
   - 输出 `{ score, feedback }`。

5. **`backend/ai/auto-mode/default-context-provider.ts`**
   - 接通真实 use case：`read_module` 的 markdown_module / use_case / function_list / ppt_pages / survey_questionnaire / project_meta 等。

6. **`backend/ai/auto-mode/orchestrator.ts`** 已实现 → 验：
   - 双 reviewer 平均分 ≥9 → pass；否则 round++ ≤ 3；
   - 任一任务 round 超限 → plan 标 `success: false`；
   - 进度事件经 SSE / log 输出。

7. **`buildDefaultAutoModePlan`**：补全 8 个任务的依赖 DAG（环境初始化 → 业务需求 → 调查任务 → 业务架构 → 技术架构 → 功能清单 → PPT 设计 → 最终 review）。

#### Frontend

1. **`auto-mode/View.vue`**（已有？检查）：UI 进度面板（task 列表 + 每条 task 的 customer + director score 实时显示 + 平均分 + 状态 + 轮数）。

### 测试
- orchestrator 用 fake reviewer / fake worker 跑 plan，验通过 / 重试 / 失败三种路径；
- 各 sub-agent spec 校验 prompt 不超 16000 字符；
- PPT designer 输出 JSON 解析正确。

---

## 10. 测试 / 验证策略

- 每个 PR 跑 `deno task check` + `deno test --no-check -A`；前端跑 `cd frontend && npm run build`。
- 端到端 1 例：跑 PR #9 的默认 plan 用 fake reviewer（固定返回 `{score: 10, feedback: "ok"}`）→ 验 worker 输出落到对应 module。
- 不引入新的数据库驱动 / 框架；新工具一律 TS 最小代码。

## 11. 风险 & 决策记录

| # | 决策 | 替代方案 | 理由 |
|---|---|---|---|
| D1 | chat composer 模型下拉读 settings.llmProfiles | 硬编码 fast/deep/local | settings 已存 profiles，避免重复 |
| D2 | chat session 用 ChatSession 而非 AiSession | 保留 AiSession | ChatSession 更轻；AiSession 仍用于高级特性 |
| D3 | 全自动开关存在 chat 内 | 单独 auto-mode 入口 | 用户原话"打开全自动模式时..." — 暗示在 chat 内 |
| D4 | 系统 sub-agent 不可改名 / 删除 | 允许改名但不允许删除 | spec 创建时绑定 name；改名会破坏路由 |
| D5 | 附件 size 限制 10 MB | 无限制 | 防 LLM context 爆；后续可调 |
| D6 | review 平均分阈值 9（10 满分），max 3 轮 | 阈值 8，5 轮 | 用户原话 "≥9，3 轮" |

## 12. Open Questions

- **Q1**：是否需要 sub-agent 调用其他 sub-agent（sub-agent-of-sub-agent）？当前 spec 只允许 main orchestrator 调度。
- **Q2**：PPT designer 是直接生成 PPT 文件（需 officecli 集成），还是仅写 PPT JSON 给前端用 dashi-ppt 渲染？

> 假定答案：**Q1 = 否**（main 只调度一级 sub-agent）；**Q2 = 否**（阶段 1 仅写 JSON；PPT 渲染放后续 sprint）。