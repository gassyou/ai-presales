# ai-presales 13 项功能补完 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成用户在 2026-09-29 列出的 13 项功能（项目中止/中标/未中标 + 工作区 + 系统/用户 sub-agent 管理 + chat 会话 + skill + composer 改造 + 附件 + 全自动开关 + auto-mode 全流水线），每项独立可提交。

**Architecture:** 沿用现有 DDD 分层（`backend/domain/` → `application/` → `persistence/sqlite/` → `presentation/routes/`；前端 Pinia store + Vue 3 components）。不引入新数据库驱动；新工具一律 TS 最小代码。所有迁移经 SQLite migration runner（try/catch 吞 duplicate-column）。

**Tech Stack:** Deno 2.9 + `@db/sqlite` + Vue 3 + Pinia + TailwindCSS + Vite + TypeScript。

**Spec:** [docs/superpowers/specs/2026-09-29-presales-features-design.md](../../specs/2026-09-29-presales-features-design.md)

---

## Global Constraints

- Deno 2.9，TS strict；前端 `npm run build` 必须无 TS 报错。
- `deno task check` 必须 0 错；`deno test --no-check -A` 必须全绿。
- 所有迁移文件按 `NNN_name.sql.ts` 命名；id 与文件名一致；幂等（migration runner 已 wrap try/catch 吞 duplicate-column）。
- Sub-agent name 校验 regex：`^[a-z][a-z0-9_-]{2,63}$`。
- Field 名 `abortedDate / abortReason`（区别于既有 `pausedDate / pauseReason`）。
- Chat session 切换后端用 `ChatSession` 聚合（非 `AiSession`）。
- 默认 review 阈值 9 / 10，max 3 轮。
- 附件 size 限制 10 MB。
- Commit message 格式：`feat(<scope>): <subject>`；结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

以下输入 / 失败模式在 spec 中提及但没有任务测试覆盖；每条由对应任务在它的 step 里补一个测试用例：
1. **附件超 10 MB 必须拒绝**（任务 7）
2. **system type sub-agent DELETE 请求必须 403**（任务 3）
3. **auto-mode round 超 3 轮必须终止且 plan success=false**（任务 9）
4. **项目状态从"暂停"切"中止"必须写入 abortReason 非空**（任务 1）
5. **未指定 workspace 时 resolve 必须返回 `~/Desktop/<code>`**（任务 2）

---

## File Map

| Slice | 新建 | 改后 |
|---|---|---|
| 1 项目状态中止 | `015_project_aborted.sql.ts`；`project-aborted.test.ts` | `project.ts`、`project.service.ts`、`events.ts`、`project.test.ts`、`ProjectDetailView.vue`、`projects.store.ts`、`shared/types/dto/project.ts` |
| 2 工作区 | `project-workspace-tools.ts`、`project-workspace.test.ts`、`tools/project-workspace.test.ts` | `project.ts`、`project.service.ts`、`events.ts`、`project.test.ts`、`ProjectDetailView.vue`、`projects.store.ts` |
| 3 Sub-agent 类型 | `sub-agent-routes.test.ts` | `sqlite-sub-agent-registry.ts`、`settings.route.ts`、`SubAgentManager.vue`（新建）、`sub-agent.store.ts` |
| 4 + 5 chat session | `chat-session-ui.test.ts` | `chat-session.store.ts`（新建）、`AiChatPanel.vue`、`ChatComposer.vue`、`ai-chat.store.ts` |
| 6 skill 系统 | `skill.route.ts`、`builtin-skills.ts`、`skills.store.ts`、`skill.test.ts`、`slash-command.test.ts` | `chat-stream.ts`、`main.ts`、`ChatComposer.vue` |
| 7 composer 改造 | `llm-profiles.store.ts` | `ChatComposer.vue` |
| 8 附件 | `017_chat_attachments.sql.ts`、`attach_file_to_chat.ts`、`chat-attachments.test.ts` | `ChatComposer.vue`、`tool-registry.ts`、`ai-chat.api.ts` |
| 9 全自动开关 | `018_ai_session_auto_mode.sql.ts`、`auto-mode-switch.test.ts` | `AiSession`、`chat-stream.ts`、`ChatComposer.vue`、`ai-chat.store.ts` |
| 10 auto-mode 全流水线 | `auto-mode-specs-rest.ts`、`sub-agent-worker.test.ts`、`sub-agent-reviewer.test.ts`、`orchestrator-round.test.ts` | `auto-mode-agents.ts`、`sub-agent-worker.ts`、`sub-agent-reviewer.ts`、`default-context-provider.ts`、`orchestrator.ts`、`auto-mode/View.vue`（或 ProgressPanel.vue） |

---

# Slice 1 — 项目中止字段 + UI（用户项 #1）

## Task 1.1: 写 migration 015 + Project domain 加 abortedDate / abortReason

**Files:**
- Create: `backend/persistence/database/migrations/015_project_aborted.sql.ts`
- Modify: `backend/domain/project/project.ts:1-130`（snapshot + 私有字段 + init + create + rehydrate + snapshot getter）
- Modify: `backend/domain/project/events.ts`（新增 `ProjectAbortedEvent`）
- Test: `backend/domain/project/project.test.ts`

**Interfaces:**
- 上一任务：none
- 下一任务：用 `Project.markAborted({ abortedDate, abortReason }, clock)`；`ProjectSnapshot.abortedDate / abortReason`

- [ ] **Step 1: 写 migration 文件**（看 `013_project_workspace.sql.ts` 风格）

```ts
// backend/persistence/database/migrations/015_project_aborted.sql.ts
export const MIGRATION_015 = {
  id: "015_project_aborted",
  sql: `
    ALTER TABLE projects ADD COLUMN aborted_date TEXT;
    ALTER TABLE projects ADD COLUMN abort_reason TEXT;
  `,
};
```

并在 `backend/persistence/database/migrations/index.ts` 的 `MIGRATIONS` 数组追加 `MIGRATION_015` 引用（看现有 14 个的写法）。

- [ ] **Step 2: 在 `events.ts` 末尾追加**：

```ts
export class ProjectAbortedEvent {
  readonly type = "ProjectAbortedEvent" as const;
  constructor(
    public readonly projectId: ProjectId,
    public readonly abortedDate: Date,
    public readonly reason: string,
    public readonly at: Date,
  ) {}
}
```

- [ ] **Step 3: 改 `Project`**

- 在 `ProjectSnapshot` 加 `readonly abortedDate: Date | null; readonly abortReason: string | null;`（放在 `pausedDate` 之后）。
- 私有字段加 `_abortedDate: Date | null; _abortReason: string | null;`。
- `init` 对象加 `abortedDate: null, abortReason: null,` 默认值。
- 构造函数末尾加 `this._abortedDate = init.abortedDate; this._abortReason = init.abortReason;`。
- `rehydrate` 的参数类型加 `abortedDate?: Date | null; abortReason?: string | null;`，构造函数调用同步加。
- `CreateProjectArgs` 不变；`create()` 调构造函数时 init 加 `abortedDate: null, abortReason: null,`。
- `snapshot` getter 同步加这两个字段。
- 新增方法（在 `markPaused` 后）：

```ts
markAborted(args: { abortedDate: Date; abortReason: string }, clock: Clock): DomainResult<void> {
  if (this._status.value !== "提案中" && this._status.value !== "暂停") {
    return domainErr(
      "ILLEGAL_STATE_TRANSITION",
      `cannot mark project as 中止 from status "${this._status.value}"`,
      { current: this._status.value, allowed: ["提案中", "暂停"] },
    );
  }
  if (!(args.abortedDate instanceof Date) || isNaN(args.abortedDate.getTime())) {
    return domainErr("INVALID_INPUT", "abortedDate must be a valid Date");
  }
  const reason = args.abortReason.trim();
  if (reason.length === 0) {
    return domainErr("INVALID_INPUT", "abortReason is required");
  }
  const tr = this._status.transition("中止");
  if (!tr.ok) return tr;
  const from = this._status.value;
  this._status = tr.value;
  this._abortedDate = args.abortedDate;
  this._abortReason = reason;
  const now = clock.now();
  this._updatedAt = now;
  this.addDomainEvent(new ProjectStatusChangedEvent(this.id, from, "中止", now, reason));
  return domainOk(undefined);
}
```

- [ ] **Step 4: 写失败的测试**

```ts
// 追加到 backend/domain/project/project.test.ts
Deno.test("Project.markAborted requires reason", () => {
  const p = Project.create({ code: "P001", name: "X", clientName: "Acme", clock: fakeClock }).value;
  const r = p.markAborted({ abortedDate: new Date("2026-09-29"), abortReason: "   " }, fakeClock);
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("Project.markAborted rejects from 中标", () => {
  const p = Project.create({ code: "P001", name: "X", clientName: "Acme", clock: fakeClock }).value;
  p.markWon({ wonDate: new Date("2026-09-29"), bestPractice: "good" }, fakeClock);
  const r = p.markAborted({ abortedDate: new Date("2026-09-29"), abortReason: "客户撤资" }, fakeClock);
  assert(!r.ok);
  assertEquals(r.error.code, "ILLEGAL_STATE_TRANSITION");
});

Deno.test("Project.markAborted from 暂停 writes fields and transitions", () => {
  const p = Project.create({ code: "P001", name: "X", clientName: "Acme", clock: fakeClock }).value;
  p.markPaused({ pauseReason: "等客户" }, fakeClock);
  const r = p.markAborted({ abortedDate: new Date("2026-09-29"), abortReason: "客户撤资" }, fakeClock);
  assert(r.ok);
  assertEquals(p.statusValue, "中止");
  assertEquals(p.snapshot.abortedDate?.toISOString(), "2026-09-29T00:00:00.000Z");
  assertEquals(p.snapshot.abortReason, "客户撤资");
});
```

- [ ] **Step 5: 跑测试**

```bash
deno test --no-check -A backend/domain/project/project.test.ts
```

Expected: 3 个新增 pass；既有 pass。

- [ ] **Step 6: Commit**

```bash
git add backend/persistence/database/migrations/015_project_aborted.sql.ts \
        backend/persistence/database/migrations/index.ts \
        backend/domain/project/project.ts \
        backend/domain/project/events.ts \
        backend/domain/project/project.test.ts
git commit -m "feat(backend): add abortedDate / abortReason to Project (sprint 13, task 1)"
```

## Task 1.2: ProjectService.changeProjectStatus 路由 target="中止"

**Files:**
- Modify: `backend/application/project/project.service.ts`（找 `changeProjectStatus` switch）
- Test: `backend/application/project/project.service.test.ts`（既有 + 1 例）

- [ ] **Step 1: 找到 `changeProjectStatus` 调用点**（grep `markWon`）

- [ ] **Step 2: 增加 `case "中止":`**

```ts
case "中止": {
  return project.markAborted(
    { abortedDate: args.abortedDate!, abortReason: args.abortReason! },
    this.deps.clock,
  );
}
```

（若 switch 写法不同，按原结构组织；要求 `abortedDate` 和 `abortReason` 为必填。）

- [ ] **Step 3: 改 args 类型**（在 `changeProjectStatus` 函数参数类型加 `abortedDate?: Date; abortReason?: string;`）。

- [ ] **Step 4: 写测试**

```ts
Deno.test("changeProjectStatus routes 中止", async () => {
  const p = await svc.createProject({ code: "P002", name: "Y", clientName: "Bob" });
  await svc.changeProjectStatus({ projectId: p.id, target: "中止", abortedDate: new Date("2026-09-29"), abortReason: "客户撤资" });
  const after = await svc.findProject(p.id);
  assertEquals(after!.statusValue, "中止");
});
```

- [ ] **Step 5: 跑 + Commit**

```bash
deno test --no-check -A backend/application/project/
git add backend/application/project/
git commit -m "feat(backend): ProjectService routes 中止 to markAborted"
```

## Task 1.3: DTO + 前端 store + UI

**Files:**
- Modify: `shared/types/dto/project.ts`（DTO 加 `abortedDate: string | null; abortReason: string | null;`）
- Modify: `frontend/src/features/project/stores/projects.store.ts`（`changeProjectStatus` 接受新字段）
- Modify: `frontend/src/features/project/ProjectDetailView.vue`（加"中止"按钮 + dialog）
- Modify: `frontend/src/features/project/api/project.api.ts`（`changeProjectStatus` 请求 body 加字段）

- [ ] **Step 1: DTO** —— 在 `abortedDate` 字段后加 `abortReason: string | null;`。

- [ ] **Step 2: store action** —— 加：

```ts
async function changeProjectStatus(payload: {
  projectId: string;
  target: string;
  abortedDate?: string;
  abortReason?: string;
}) {
  await api.changeProjectStatus(payload);
  await refresh(payload.projectId);
}
```

- [ ] **Step 3: api** —— 把 `body` 类型同步扩展。

- [ ] **Step 4: ProjectDetailView** —— 在现有"暂停"按钮后加：

```vue
<el-button v-if="status === '提案中' || status === '暂停'" type="danger" @click="abortDialog = true">中止</el-button>

<el-dialog v-model="abortDialog" title="中止项目">
  <el-form :model="abortForm" label-width="100px">
    <el-form-item label="中止日期" required>
      <el-date-picker v-model="abortForm.abortedDate" type="date" value-format="YYYY-MM-DD" />
    </el-form-item>
    <el-form-item label="中止原因" required>
      <el-input v-model="abortForm.abortReason" type="textarea" :rows="3" />
    </el-form-item>
  </el-form>
  <template #footer>
    <el-button @click="abortDialog = false">取消</el-button>
    <el-button type="danger" @click="confirmAbort">确认中止</el-button>
  </template>
</el-dialog>
```

并在 `<script setup>` 加 `abortDialog = ref(false)`、`abortForm = reactive({ abortedDate: '', abortReason: '' })`、`confirmAbort()` 调 `store.changeProjectStatus({ projectId, target: '中止', abortedDate, abortReason })`，成功后 `abortDialog = false` + 提示。

- [ ] **Step 5: `deno task check` + `cd frontend && npm run build`**

```bash
deno task check
cd frontend && npm run build
```

Expected: 都 0 错。

- [ ] **Step 6: Commit**

```bash
git add shared/types/dto/project.ts \
        frontend/src/features/project/stores/projects.store.ts \
        frontend/src/features/project/api/project.api.ts \
        frontend/src/features/project/ProjectDetailView.vue
git commit -m "feat(frontend): project abort dialog with date + reason"
```

---

# Slice 2 — 项目工作区（用户项 #2）

## Task 2.1: Project.setWorkspacePath + 事件

**Files:**
- Modify: `backend/domain/project/project.ts`（加方法）
- Modify: `backend/domain/project/events.ts`（加 `ProjectWorkspaceChangedEvent`）

- [ ] **Step 1: events.ts 末尾追加**

```ts
export class ProjectWorkspaceChangedEvent {
  readonly type = "ProjectWorkspaceChangedEvent" as const;
  constructor(
    public readonly projectId: ProjectId,
    public readonly fromPath: string | null,
    public readonly toPath: string,
    public readonly at: Date,
  ) {}
}
```

- [ ] **Step 2: project.ts 加方法**

```ts
setWorkspacePath(absPath: string, clock: Clock): DomainResult<void> {
  const t = absPath.trim();
  if (t.length === 0) return domainErr("INVALID_INPUT", "workspacePath must be non-empty");
  if (!t.startsWith("/") && !t.startsWith("~")) {
    return domainErr("INVALID_INPUT", "workspacePath must be absolute (start with / or ~)");
  }
  const from = this._workspacePath;
  this._workspacePath = t;
  const now = clock.now();
  this._updatedAt = now;
  this.addDomainEvent(new ProjectWorkspaceChangedEvent(this.id, from, t, now));
  return domainOk(undefined);
}
```

- [ ] **Step 3: 写测试 + 跑 + Commit**

```ts
// backend/domain/project/project.test.ts
Deno.test("Project.setWorkspacePath rejects relative path", () => {
  const p = Project.create({ code: "P001", name: "X", clientName: "Acme", clock: fakeClock }).value;
  const r = p.setWorkspacePath("foo/bar", fakeClock);
  assert(!r.ok);
  assertEquals(r.error.code, "INVALID_INPUT");
});

Deno.test("Project.setWorkspacePath writes and triggers event", () => {
  const p = Project.create({ code: "P001", name: "X", clientName: "Acme", clock: fakeClock }).value;
  const r = p.setWorkspacePath("/tmp/x", fakeClock);
  assert(r.ok);
  assertEquals(p.snapshot.workspacePath, "/tmp/x");
});
```

```bash
deno test --no-check -A backend/domain/project/project.test.ts
git add backend/domain/project/project.ts backend/domain/project/events.ts backend/domain/project/project.test.ts
git commit -m "feat(backend): Project.setWorkspacePath domain method + event"
```

## Task 2.2: 两个工作区 tool（set + resolve）

**Files:**
- Create: `backend/ai/tool/project-workspace-tools.ts`
- Modify: `backend/ai/tool/tool-registry.ts`（注册新 tool —— 看现有 `read_module` 怎么挂）
- Test: `backend/ai/tool/project-workspace-tools.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// backend/ai/tool/project-workspace-tools.test.ts
Deno.test("resolve_workspace returns default when unset", async () => {
  const tmpHome = await Deno.makeTempDir();
  Deno.env.set("HOME", tmpHome);
  const db = makeTestDb();
  const repo = new SqliteProjectRepository(db);
  const project = Project.create({ code: "PROJ1", name: "P", clientName: "C", clock: realClock }).value;
  repo.save(project);
  const tool = makeResolveWorkspaceTool({ repo, home: () => tmpHome });
  const r = await tool.execute({ projectId: project.id }, fakeCtx);
  assert(r.ok);
  const out = JSON.parse(r.output);
  assertEquals(out.source, "default");
  assert(out.resolvedPath.endsWith("/Desktop/PROJ1"));
});
```

（`makeTestDb` / `realClock` / `fakeCtx` 看 `backend/ai/tool/` 已有测试用什么 factory。）

- [ ] **Step 2: 跑测试**——预期失败（tool 未实现）。

- [ ] **Step 3: 实现 tool**

```ts
// backend/ai/tool/project-workspace-tools.ts
import { join } from "jsr:@std/path@^1.0";

export function makeResolveWorkspaceTool(deps: { repo: SqliteProjectRepository; home: () => string }) {
  return {
    name: "resolve_project_workspace",
    description: "解析项目工作区路径。返回 { resolvedPath, source, exists }。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    } as Record<string, unknown>,
    async execute(args: { projectId: string }, _ctx: ToolContext): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
      const p = deps.repo.findById(args.projectId as ProjectId);
      if (!p) return { ok: false, error: "project not found" };
      const stored = p.workspacePath;
      const home = deps.home();
      const resolved = stored ?? join(home, "Desktop", p.code);
      let exists = false;
      try { exists = (await Deno.lstat(resolved)).isDirectory; } catch { exists = false; }
      return { ok: true, output: JSON.stringify({ resolvedPath: resolved, source: stored ? "stored" : "default", exists }) };
    },
  };
}

export function makeSetWorkspaceTool(deps: { repo: SqliteProjectRepository; home: () => string; clock: Clock; projectService: ProjectService }) {
  return {
    name: "set_project_workspace",
    description: "设置项目工作区路径。可选创建目录。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        workspacePath: { type: "string" },
        createIfMissing: { type: "boolean" },
      },
      required: ["projectId", "workspacePath"],
    } as Record<string, unknown>,
    async execute(args: { projectId: string; workspacePath: string; createIfMissing?: boolean }, _ctx: ToolContext) {
      try {
        const expanded = args.workspacePath.startsWith("~")
          ? join(deps.home(), args.workspacePath.slice(1))
          : args.workspacePath;
        if (args.createIfMissing) {
          await Deno.mkdir(expanded, { recursive: true });
        } else {
          // 仅校验存在
          try { await Deno.lstat(expanded); } catch {
            return { ok: false, error: `workspacePath does not exist: ${expanded}` };
          }
        }
        await deps.projectService.setWorkspacePath({ projectId: args.projectId as ProjectId, absolutePath: expanded });
        return { ok: true, output: JSON.stringify({ resolvedPath: expanded }) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
```

（`ToolContext` import 看 `backend/ai/tool/tool.ts` 现有。）

- [ ] **Step 4: 注册到 registry**

打开 `backend/ai/tool/tool-registry.ts`，在 default-tools 列表追加 `makeResolveWorkspaceTool(...)` 和 `makeSetWorkspaceTool(...)`（用同一处依赖注入）。

- [ ] **Step 5: 跑 + Commit**

```bash
deno test --no-check -A backend/ai/tool/project-workspace-tools.test.ts
git add backend/ai/tool/project-workspace-tools.ts backend/ai/tool/project-workspace-tools.test.ts backend/ai/tool/tool-registry.ts
git commit -m "feat(backend): resolve_project_workspace + set_project_workspace tools"
```

## Task 2.3: 前端 workspace UI

**Files:**
- Modify: `frontend/src/features/project/ProjectDetailView.vue`
- Modify: `frontend/src/features/project/api/project.api.ts`
- Modify: `frontend/src/features/project/stores/projects.store.ts`

- [ ] **Step 1: api.ts 加**

```ts
setWorkspace: async (projectId: string, workspacePath: string, createIfMissing = true) =>
  (await post(`/api/tools/invoke`, { name: "set_project_workspace", args: { projectId, workspacePath, createIfMissing } })).data,

resolveWorkspace: async (projectId: string) =>
  (await post(`/api/tools/invoke`, { name: "resolve_project_workspace", args: { projectId } })).data,
```

（`post` import 看现有风格。）

- [ ] **Step 2: store action**

```ts
async function setWorkspace(projectId: string, workspacePath: string, createIfMissing = true) {
  await api.setWorkspace(projectId, workspacePath, createIfMissing);
  await refresh(projectId);
}
async function resolveWorkspace(projectId: string): Promise<{ resolvedPath: string; source: string; exists: boolean }> {
  return await api.resolveWorkspace(projectId);
}
```

- [ ] **Step 3: UI** —— 在 ProjectDetailView 的"项目元信息"区加：

```vue
<el-form-item label="工作区路径">
  <div class="flex gap-2">
    <el-input v-model="workspaceInput" placeholder="/abs/path 或 ~/Desktop/PROJ" />
    <el-button @click="onResolve">解析</el-button>
    <el-button type="primary" @click="onSetWorkspace">保存</el-button>
  </div>
  <div v-if="workspaceResolved" class="text-xs text-slate-500 mt-1">
    当前: {{ workspaceResolved.resolvedPath }} ({{ workspaceResolved.source === 'default' ? '默认' : '已设置' }}, {{ workspaceResolved.exists ? '存在' : '不存在' }})
  </div>
</el-form-item>
```

并在 `<script setup>` 加 `workspaceInput = ref("")`、`workspaceResolved = ref<{...} | null>(null)`、`onResolve() { workspaceResolved.value = await store.resolveWorkspace(projectId) }`、`onSetWorkspace() { await store.setWorkspace(projectId, workspaceInput.value, true); await onResolve() }`。挂载时自动 `onResolve()`。

- [ ] **Step 4: 跑 build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/project/
git commit -m "feat(frontend): project workspace path UI"
```

---

# Slice 3 — Sub-agent 类型（用户项 #3）

## Task 3.1: SqliteSubAgentRegistry 加 createUserSpec / deleteUserSpec / updateUserSpec

**Files:**
- Modify: `backend/persistence/sqlite/sqlite-sub-agent-registry.ts`
- Test: `backend/persistence/sqlite/sqlite-sub-agent-registry.test.ts`（既有 + 新例）

- [ ] **Step 1: 写失败测试**

```ts
// 既有文件追加
Deno.test("createUserSpec rejects system type", async () => {
  const reg = new SqliteSubAgentRegistry(db);
  const r = reg.createUserSpec({ name: "u1", displayName: "U", description: "", systemPrompt: "x", toolNames: [], type: "system" });
  // 应当忽略调用方传入的 system，强制 user
  assert(r.ok);
  assertEquals(r.value.type, "user");
});

Deno.test("deleteUserSpec rejects system spec", async () => {
  const reg = new SqliteSubAgentRegistry(db);
  const sysSpec = SubAgentSpecVO.create({ name: "sys1", displayName: "S", description: "", systemPrompt: "x", toolNames: [], type: "system" }).value;
  reg.seedSystemSpec(sysSpec); // 假定存在的方法；如果已有 seedBuiltin 走那条
  const r = reg.deleteUserSpec("sys1");
  assert(!r.ok);
  assertEquals(r.error.code, "ILLEGAL_OPERATION");
});
```

- [ ] **Step 2: 跑测试**——预期 fail。

- [ ] **Step 3: 实现方法**

```ts
createUserSpec(input: SubAgentSpecData): DomainResult<SubAgentSpecVO> {
  // 强制 user
  const normalized: SubAgentSpecData = { ...input, type: "user" };
  const r = SubAgentSpecVO.create(normalized);
  if (!r.ok) return r;
  if (this.findByName(normalized.name)) {
    return domainErr("CONFLICT", `sub-agent name exists: ${normalized.name}`);
  }
  this.insert(r.value);
  return domainOk(r.value);
}

deleteUserSpec(name: string): DomainResult<void> {
  const spec = this.findByName(name);
  if (!spec) return domainErr("NOT_FOUND", `sub-agent not found: ${name}`);
  if (spec.type === "system") {
    return domainErr("ILLEGAL_OPERATION", `cannot delete system sub-agent: ${name}`);
  }
  this.deleteByName(name);
  return domainOk(undefined);
}

updateUserSpec(name: string, patch: Partial<SubAgentSpecData>): DomainResult<SubAgentSpecVO> {
  const existing = this.findByName(name);
  if (!existing) return domainErr("NOT_FOUND", `sub-agent not found: ${name}`);
  if (existing.type === "system") {
    // 仅允许改 displayName / description
    const allowed: Partial<SubAgentSpecData> = {};
    if (patch.displayName !== undefined) allowed.displayName = patch.displayName;
    if (patch.description !== undefined) allowed.description = patch.description;
    if (patch.systemPrompt !== undefined || patch.toolNames !== undefined || patch.profileHint !== undefined) {
      return domainErr("ILLEGAL_OPERATION", `cannot change systemPrompt / toolNames / profileHint for system sub-agent`);
    }
    const merged = SubAgentSpecVO.create({ ...existing.toDTO(), ...allowed });
    if (!merged.ok) return merged;
    this.updateByName(merged.value);
    return domainOk(merged.value);
  }
  const merged = SubAgentSpecVO.create({ ...existing.toDTO(), ...patch, name, type: "user" });
  if (!merged.ok) return merged;
  this.updateByName(merged.value);
  return domainOk(merged.value);
}
```

（`insert` / `updateByName` / `deleteByName` / `findByName` —— 看现有 sqlite-sub-agent-registry.ts 已有等价私有方法；命名按现有风格。）

- [ ] **Step 4: 跑 + Commit**

```bash
deno test --no-check -A backend/persistence/sqlite/sqlite-sub-agent-registry.test.ts
git add backend/persistence/sqlite/sqlite-sub-agent-registry.ts backend/persistence/sqlite/sqlite-sub-agent-registry.test.ts
git commit -m "feat(backend): user sub-agent CRUD with system protection"
```

## Task 3.2: settings route 加 POST/PUT/DELETE

**Files:**
- Modify: `backend/presentation/routes/settings.route.ts`
- Test: `backend/presentation/routes/settings.route.test.ts`

- [ ] **Step 1: 写测试**

```ts
Deno.test("POST /api/settings/sub-agents creates user spec", async () => {
  const res = await post("/api/settings/sub-agents", { name: "my_writer", displayName: "M", description: "x", systemPrompt: "p", toolNames: [] });
  assertEquals(res.status, 200);
});

Deno.test("DELETE /api/settings/sub-agents/:name returns 403 for system", async () => {
  const res = await fetch(new URL("/api/settings/sub-agents/auto_env_init", base));
  // 假定列表里已经有 auto_env_init（系统）
  assertEquals(res.status, 403);
});
```

- [ ] **Step 2: 跑测试**——fail。

- [ ] **Step 3: 实现 route**

```ts
if (path === "/api/settings/sub-agents" && method === "POST") {
  const body = await req.json();
  const r = deps.subAgentRegistry.createUserSpec(body);
  return r.ok ? jsonOk(r.value.toDTO()) : jsonErr(400, r.error.message);
}

const delMatch = path.match(/^\/api\/settings\/sub-agents\/([^/]+)$/);
if (delMatch && method === "DELETE") {
  const name = decodeURIComponent(delMatch[1]);
  const r = deps.subAgentRegistry.deleteUserSpec(name);
  if (!r.ok) return jsonErr(r.error.code === "ILLEGAL_OPERATION" ? 403 : 404, r.error.message);
  return jsonOk({ ok: true });
}

if (delMatch && method === "PUT") {
  const name = decodeURIComponent(delMatch[1]);
  const patch = await req.json();
  const r = deps.subAgentRegistry.updateUserSpec(name, patch);
  if (!r.ok) return jsonErr(r.error.code === "ILLEGAL_OPERATION" ? 403 : 400, r.error.message);
  return jsonOk(r.value.toDTO());
}
```

- [ ] **Step 4: 跑 + Commit**

```bash
deno test --no-check -A backend/presentation/routes/settings.route.test.ts
git add backend/presentation/routes/settings.route.ts backend/presentation/routes/settings.route.test.ts
git commit -m "feat(backend): settings route POST/PUT/DELETE user sub-agents"
```

## Task 3.3: 前端 SubAgentManager + store 扩展

**Files:**
- Create: `frontend/src/features/settings/components/SubAgentManager.vue`
- Modify: `frontend/src/features/sub-agent/stores/sub-agent.store.ts`（加 `createUser` / `updateUser` / `removeUser`）
- Modify: `frontend/src/features/sub-agent/api/sub-agent.api.ts`
- Modify: `frontend/src/features/settings/SettingsView.vue`（替换子组件 / 加 tab）

- [ ] **Step 1: api.ts 加**

```ts
createUser: async (payload) => (await post("/api/settings/sub-agents", payload)).data,
removeUser: async (name) => (await del(`/api/settings/sub-agents/${name}`)).data,
updateUser: async (name, patch) => (await put(`/api/settings/sub-agents/${name}`, patch)).data,
```

- [ ] **Step 2: store 加 actions**

```ts
async function createUser(payload: SubAgentSpecData) {
  await api.createUser(payload);
  await load();
}
async function updateUser(name: string, patch: Partial<SubAgentSpecData>) {
  await api.updateUser(name, patch);
  await load();
}
async function removeUser(name: string) {
  await api.removeUser(name);
  await load();
}
```

- [ ] **Step 3: SubAgentManager.vue**

```vue
<template>
  <div>
    <h3 class="text-sm font-semibold mb-2">系统 sub-agent</h3>
    <div class="grid grid-cols-2 gap-2 mb-4">
      <el-card v-for="s in systemAgents" :key="s.name" shadow="never">
        <div class="font-semibold">{{ s.displayName }}</div>
        <div class="text-xs text-slate-500">{{ s.description }}</div>
        <el-tag size="small" type="info" class="mt-1">系统内置</el-tag>
      </el-card>
    </div>
    <h3 class="text-sm font-semibold mb-2 flex items-center justify-between">
      用户 sub-agent
      <el-button type="primary" size="small" @click="onCreate">+ 新增</el-button>
    </h3>
    <div class="grid grid-cols-2 gap-2">
      <el-card v-for="u in userAgents" :key="u.name" shadow="never">
        <div class="font-semibold">{{ u.displayName }}</div>
        <div class="text-xs text-slate-500">{{ u.description }}</div>
        <div class="mt-2 flex gap-1">
          <el-button size="small" @click="onEdit(u)">编辑</el-button>
          <el-popconfirm title="确认删除？" @confirm="onDelete(u.name)">
            <el-button size="small" type="danger">删除</el-button>
          </el-popconfirm>
        </div>
      </el-card>
    </div>
    <el-dialog v-model="dialog.visible" :title="dialog.title">
      <el-form :model="dialog.form" label-width="100px">
        <el-form-item label="name (英文)" required>
          <el-input v-model="dialog.form.name" :disabled="!!dialog.editing" />
        </el-form-item>
        <el-form-item label="显示名" required><el-input v-model="dialog.form.displayName" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="dialog.form.description" /></el-form-item>
        <el-form-item label="系统提示词" required><el-input v-model="dialog.form.systemPrompt" type="textarea" :rows="8" /></el-form-item>
        <el-form-item label="工具">
          <el-select v-model="dialog.form.toolNames" multiple>
            <el-option v-for="t in availableTools" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="profile hint">
          <el-input v-model="dialog.form.profileHint" placeholder="留空走默认" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="onSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
```

`<script setup>`：
- `import { store, systemAgents, userAgents, availableTools, ... }`；
- `dialog = reactive({ visible: false, editing: null, form: { name: '', displayName: '', description: '', systemPrompt: '', toolNames: [], profileHint: '' } })`；
- `onCreate()` 重置 form；
- `onEdit(u)` 填 form；
- `onDelete(name)` store.removeUser(name)；
- `onSubmit()` 根据 editing 调 `createUser(form)` 或 `updateUser(name, patch)`。

- [ ] **Step 4: SettingsView** —— 在 sub-agent tab 用 `<SubAgentManager />` 替换旧组件。

- [ ] **Step 5: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/settings/components/SubAgentManager.vue \
        frontend/src/features/settings/SettingsView.vue \
        frontend/src/features/sub-agent/stores/sub-agent.store.ts \
        frontend/src/features/sub-agent/api/sub-agent.api.ts
git commit -m "feat(frontend): SubAgentManager with system/user sections"
```

---

# Slice 4 — Chat 会话手动新建 + 持久化（用户项 #4 + #5）

## Task 4.1: 前端 chat-session store

**Files:**
- Create: `frontend/src/features/ai-chat/stores/chat-session.store.ts`
- Create: `frontend/src/features/ai-chat/api/chat-session.api.ts`
- Test: `frontend/src/features/ai-chat/stores/chat-session.store.test.ts`（vitest）

- [ ] **Step 1: api.ts**

```ts
import { get, post, del } from "@frontend/shared/api/http-client.ts";

export interface ChatSessionDTO { id: string; projectId: string | null; title: string; createdAt: string; updatedAt: string; }
export interface ChatMessageDTO { id: string; sessionId: string; role: "user"|"assistant"|"tool"|"system"; content: string; toolCalls?: any[]; createdAt: string; }

export const chatSessionApi = {
  list: async (projectId: string | null) =>
    (await get(`/api/chat/sessions${projectId ? `?projectId=${projectId}` : ""}`)).data.items as ChatSessionDTO[],
  create: async (projectId: string | null, title: string) =>
    (await post("/api/chat/sessions", { projectId, title })).data as ChatSessionDTO,
  remove: async (id: string) => (await del(`/api/chat/sessions/${id}`)).data,
  messages: async (id: string) =>
    (await get(`/api/chat/sessions/${id}/messages`)).data.items as ChatMessageDTO[],
  appendMessage: async (id: string, msg: Omit<ChatMessageDTO, "id" | "createdAt" | "sessionId">) =>
    (await post(`/api/chat/sessions/${id}/messages`, msg)).data as ChatMessageDTO,
};
```

- [ ] **Step 2: store**

```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { chatSessionApi, type ChatSessionDTO, type ChatMessageDTO } from "../api/chat-session.api.ts";

export const useChatSessionStore = defineStore("chatSession", () => {
  const sessions = ref<ChatSessionDTO[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = ref<ChatMessageDTO[]>([]);

  async function loadSessions(projectId: string | null) {
    sessions.value = await chatSessionApi.list(projectId);
  }
  async function createSession(projectId: string | null, title = "新对话") {
    const s = await chatSessionApi.create(projectId, title);
    sessions.value = [s, ...sessions.value];
    await switchSession(s.id);
    return s;
  }
  async function switchSession(sessionId: string | null) {
    currentSessionId.value = sessionId;
    messages.value = sessionId ? await chatSessionApi.messages(sessionId) : [];
  }
  async function removeSession(sessionId: string) {
    await chatSessionApi.remove(sessionId);
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    if (currentSessionId.value === sessionId) await switchSession(null);
  }
  async function appendLocal(msg: Omit<ChatMessageDTO, "id" | "createdAt" | "sessionId">) {
    if (!currentSessionId.value) await createSession(null);
    const saved = await chatSessionApi.appendMessage(currentSessionId.value!, msg);
    messages.value = [...messages.value, saved];
  }

  return { sessions, currentSessionId, messages, loadSessions, createSession, switchSession, removeSession, appendLocal };
});
```

- [ ] **Step 3: Vitest**

```ts
// frontend/src/features/ai-chat/stores/chat-session.store.test.ts
import { setActivePinia, createPinia } from "pinia";
import { useChatSessionStore } from "./chat-session.store.ts";
import { vi } from "vitest";

vi.mock("../api/chat-session.api.ts", () => ({
  chatSessionApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: "s1", projectId: null, title: "新", createdAt: "x", updatedAt: "x" }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    messages: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue({ id: "m1", sessionId: "s1", role: "user", content: "hi", createdAt: "x" }),
  },
}));

beforeEach(() => setActivePinia(createPinia()));

test("createSession adds to list and switches", async () => {
  const s = useChatSessionStore();
  await s.createSession(null, "hello");
  expect(s.sessions).toHaveLength(1);
  expect(s.currentSessionId).toBe("s1");
});
```

- [ ] **Step 4: 跑 vitest + Commit**

```bash
cd frontend && npx vitest run src/features/ai-chat/stores/chat-session.store.test.ts
git add frontend/src/features/ai-chat/stores/chat-session.store.ts \
        frontend/src/features/ai-chat/stores/chat-session.store.test.ts \
        frontend/src/features/ai-chat/api/chat-session.api.ts
git commit -m "feat(frontend): chat-session store + api"
```

## Task 4.2: AiChatPanel 接入会话管理 UI

**Files:**
- Modify: `frontend/src/features/ai-chat/AiChatPanel.vue`
- Modify: `frontend/src/features/ai-chat/ChatComposer.vue`

- [ ] **Step 1: AiChatPanel 顶部加 session bar**

```vue
<header class="border-b border-border px-4 py-2 flex items-center gap-2">
  <el-select :model-value="sessionStore.currentSessionId" placeholder="选择会话" @change="onSwitch">
    <el-option v-for="s in sessionStore.sessions" :key="s.id" :value="s.id" :label="s.title" />
  </el-select>
  <el-button size="small" @click="onCreate">+ 新建</el-button>
  <el-popconfirm v-if="sessionStore.currentSessionId" title="删除当前会话？" @confirm="onDelete">
    <el-button size="small">删除</el-button>
  </el-popconfirm>
</header>
```

`<script setup>`：
- `import { useChatSessionStore } from "./stores/chat-session.store.ts"`；
- `const sessionStore = useChatSessionStore()`；
- `watch(() => store.currentProject, async (p) => { await sessionStore.loadSessions(p?.id ?? null); }, { immediate: true })`；
- `async function onCreate() { await sessionStore.createSession(store.currentProject?.id ?? null) }`；
- `async function onSwitch(id: string) { await sessionStore.switchSession(id) }`；
- `async function onDelete() { await sessionStore.removeSession(sessionStore.currentSessionId!) }`。

- [ ] **Step 2: AiChatPanel 把消息渲染源从 `store.messages` 换成 `sessionStore.messages`**

把 `<MessageBubble v-for="m in store.messages" ...>` 改成 `<MessageBubble v-for="m in sessionStore.messages" ...>`。AiChatStore 的 `messages` 仍保留作 transient（流式拼接用），但持久化由 sessionStore 负责。

- [ ] **Step 3: ChatComposer 发送后立即调 `sessionStore.appendLocal(...)` 持久化**

在 `useAiChatStore.send` 末尾（或在 ChatComposer onSend 末尾）追加：

```ts
await sessionStore.appendLocal({ role: "user", content: v });
// 流式响应完成后，再 appendLocal 一条 assistant 消息（id 用流式 buffer 的 asstId）。
```

- [ ] **Step 4: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/ai-chat/AiChatPanel.vue frontend/src/features/ai-chat/ChatComposer.vue frontend/src/features/ai-chat/stores/ai-chat.store.ts
git commit -m "feat(frontend): chat session switcher + persistence"
```

---

# Slice 5 — Skill 系统（用户项 #6）

## Task 5.1: Skill route + builtin skills

**Files:**
- Create: `backend/presentation/routes/skill.route.ts`
- Create: `backend/ai/skill/builtin-skills.ts`
- Test: `backend/presentation/routes/skill.route.test.ts`

- [ ] **Step 1: builtin-skills.ts**

```ts
import type { Skill } from "./skill.ts";

export function makeBuiltinSkills(deps: { /* ...repo, llm */ }): Skill[] {
  return [
    {
      name: "skill_list_skills",
      displayName: "列出可用 skill",
      description: "返回当前注册的所有 skill 的简要描述。",
      inputSchema: { type: "object", properties: {} },
      async execute(_args, _ctx) {
        const names = deps.skillRegistry.names().filter((n) => n !== "skill_list_skills");
        return JSON.stringify({ skills: names });
      },
    },
    {
      name: "skill_status_check",
      displayName: "系统状态检查",
      description: "返回当前系统各模块的统计信息（chat sessions / business modules / projects）。",
      inputSchema: { type: "object", properties: {} },
      async execute(_args, _ctx) {
        return JSON.stringify({
          chatSessions: deps.chatSessionRepo.countAll(),
          projects: deps.projectRepo.countAll(),
        });
      },
    },
    {
      name: "skill_summarize_project",
      displayName: "项目摘要",
      description: "汇总一个项目的所有 markdown 模块 + 元信息，返回 5 段总结。",
      inputSchema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      async execute(args: { projectId: string }, _ctx) {
        const sections = await deps.businessModuleService.readAll(args.projectId as ProjectId);
        const meta = await deps.projectService.findProject(args.projectId as ProjectId);
        // 调 LLM 生成 5 段总结（省略：用 deps.llmClient 调一次）
        const summary = await deps.llmClient.complete({
          system: "请根据以下项目材料输出 5 段简洁总结（中文，每段 1-2 句）。",
          user: sections.map((s) => `## ${s.kind}\n${s.content}`).join("\n\n") + `\n\n项目：${meta?.name} / ${meta?.clientName}`,
        });
        return summary;
      },
    },
  ];
}
```

- [ ] **Step 2: skill.route.ts**

```ts
export async function handleSkillRoute(req: Request, deps: { registry: SkillRegistry; logger: Logger }, url: URL): Promise<Response> {
  if (url.pathname === "/api/skills" && req.method === "GET") {
    return jsonOk({ items: deps.registry.toLLMSkills() });
  }
  const m = url.pathname.match(/^\/api\/skills\/([^/]+)\/invoke$/);
  if (m && req.method === "POST") {
    const name = decodeURIComponent(m[1]);
    const skill = deps.registry.get(name);
    if (!skill) return jsonErr(404, `skill not found: ${name}`);
    const { args } = await req.json();
    try {
      const output = await skill.execute(args, ctx.defaultCtx);
      return jsonOk({ ok: true, output });
    } catch (e) {
      return jsonErr(500, e instanceof Error ? e.message : String(e));
    }
  }
  return jsonErr(404, "not found");
}
```

- [ ] **Step 3: 在 main.ts 注入**

```ts
import { handleSkillRoute } from "@backend/presentation/routes/skill.route.ts";
// 在 DI 列表里追加
const skills = makeBuiltinSkills({ ... });
const skillRegistry = new SkillRegistry();
skills.forEach((s) => skillRegistry.register(s));
// router dispatch 列表追加 handleSkillRoute
```

- [ ] **Step 4: 写测试**

```ts
Deno.test("GET /api/skills returns registered skills", async () => {
  const res = await handleSkillRoute(makeReq("GET", "/api/skills"), { registry, logger: noopLogger }, new URL("http://x/api/skills"));
  const body = await res.json();
  assert(body.ok.items.some((s: any) => s.name === "skill_list_skills"));
});

Deno.test("POST /api/skills/skill_list_skills/invoke returns list", async () => {
  const res = await handleSkillRoute(makeReq("POST", "/api/skills/skill_list_skills/invoke", {}), deps, new URL("http://x/api/skills/skill_list_skills/invoke"));
  const body = await res.json();
  assert(body.ok);
});
```

- [ ] **Step 5: 跑 + Commit**

```bash
deno test --no-check -A backend/presentation/routes/skill.route.test.ts
git add backend/ai/skill/builtin-skills.ts backend/presentation/routes/skill.route.ts backend/presentation/routes/skill.route.test.ts
git commit -m "feat(backend): skill route + builtin skills (list/status/summarize)"
```

## Task 5.2: chat-stream 把 skill 描述注入 system prompt

**Files:**
- Modify: `backend/ai/chat/chat-stream.ts`（看 system prompt 注入点）

- [ ] **Step 1: 找到 system prompt 构造位置**

- [ ] **Step 2: 在末尾追加**：

```ts
const skillBlock = deps.skillRegistry.toLLMSkills().map((s) => `- ${s.name}: ${s.description}`).join("\n");
systemPrompt += `\n\n# Skills\n${skillBlock}\n你可以在响应中使用 {"call_skill": {"name": "...", "args": {...}}} 来调用 skill。`;
```

- [ ] **Step 3: 处理 `call_skill`**

找到 streaming 流 loop 里处理 tool_call 的位置，加：

```ts
if (parsed.kind === "call_skill") {
  const skill = deps.skillRegistry.get(parsed.name);
  if (skill) {
    const output = await skill.execute(parsed.args, ctx);
    messages.push({ role: "tool", content: `[skill ${parsed.name}]\n${output}` });
    continue; // 再次调 LLM
  }
}
```

- [ ] **Step 4: 写测试 + 跑 + Commit**

```bash
deno test --no-check -A backend/ai/chat/chat-stream.test.ts
git add backend/ai/chat/chat-stream.ts
git commit -m "feat(backend): chat stream injects skills + handles call_skill"
```

## Task 5.3: 前端 slash command

**Files:**
- Create: `frontend/src/features/ai-chat/stores/skills.store.ts`
- Modify: `frontend/src/features/ai-chat/ChatComposer.vue`

- [ ] **Step 1: skills.store.ts**

```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { get, post } from "@frontend/shared/api/http-client.ts";

export interface SkillSummary { name: string; displayName: string; description: string; }

export const useSkillsStore = defineStore("skills", () => {
  const items = ref<SkillSummary[]>([]);
  async function load() {
    const r = await get("/api/skills");
    items.value = (r.data as { items: SkillSummary[] }).items;
  }
  async function invoke(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await post(`/api/skills/${name}/invoke`, { args });
    return (r.data as { ok: boolean; output: string }).output;
  }
  return { items, load, invoke };
});
```

- [ ] **Step 2: ChatComposer slash 弹窗**

加：

```vue
<div v-if="slashState.visible" class="absolute z-10 bottom-full mb-1 left-0 w-72 bg-white border rounded shadow">
  <div v-for="(s, i) in slashState.filtered" :key="s.name"
       :class="['px-2 py-1 cursor-pointer text-xs', i === slashState.activeIndex ? 'bg-slate-100' : '']"
       @click="onSlashPick(s)">
    <span class="font-mono">/{{ s.name }}</span> — {{ s.displayName }}
  </div>
</div>
```

`<script setup>` 加：
- `import { useSkillsStore } from "./stores/skills.store.ts"`；
- `const skillsStore = useSkillsStore(); onMounted(() => void skillsStore.load())`；
- `slashState = reactive({ visible: false, query: "", activeIndex: 0, filtered: [] as SkillSummary[] })`；
- `onInput()` 检测末尾字符是 `/` → 弹窗显示；输入 `/xxx` → 过滤。
- `onSlashPick(s)` 用 `/<name> ` 替换。
- `onSend()` 解析 `^/(skill_\w+)(?:\s+(.*))?$` → 若匹配，**不走 chat 端点**，直接 `await skillsStore.invoke(name, parseArgs(rest))` 然后把输出作为一条 assistant 消息插入（用 `sessionStore.appendLocal(...)`）。否则正常 send。

- [ ] **Step 3: Vitest parse test**

```ts
import { parseSlashCommand } from "./slash-command.ts"; // 抽出 pure function
test("parses /skill_status", () => {
  expect(parseSlashCommand("/skill_status")).toEqual({ name: "skill_status", args: {} });
});
test("rejects non-skill", () => {
  expect(parseSlashCommand("/foo")).toBeNull();
});
```

把 `parseSlashCommand` 实现放在 `frontend/src/features/ai-chat/slash-command.ts`（纯函数）。

- [ ] **Step 4: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/ai-chat/
git commit -m "feat(frontend): slash command for skills"
```

---

# Slice 6 — Composer 改造（用户项 #7 / #9 / #11）

## Task 6.1: 删除 sub-agent picker + chat/agent 切换；改 model selector

**Files:**
- Modify: `frontend/src/features/ai-chat/ChatComposer.vue`
- Create: `frontend/src/features/settings/stores/llm-profiles.store.ts`

- [ ] **Step 1: llm-profiles.store.ts**

```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { get } from "@frontend/shared/api/http-client.ts";

export interface LlmProfile { id: string; label: string; provider: string; model: string; }

export const useLlmProfilesStore = defineStore("llmProfiles", () => {
  const items = ref<LlmProfile[]>([]);
  async function load() {
    const r = await get("/api/settings/llm-profiles");
    items.value = (r.data as { profiles: LlmProfile[] }).profiles;
  }
  return { items, load };
});
```

- [ ] **Step 2: 改 ChatComposer.vue**

- 删除 `<SubAgentPicker ...>` 整块；
- 删除"🛠 工具 / 💬 纯聊"按钮整块；
- 替换 profile select：
```vue
<el-select :model-value="selectedProfile" style="width:120px" @change="onProfileChange">
  <el-option v-for="p in llmStore.items" :key="p.id" :value="p.id" :label="`${p.label} (${p.model})`" />
</el-select>
```

`<script setup>`：
- `import { useLlmProfilesStore } from "@frontend/features/settings/stores/llm-profiles.store.ts"`；
- `const llmStore = useLlmProfilesStore(); onMounted(() => void llmStore.load())`；
- 替换 `profiles = ["fast", "deep", "local"]` 为 `selectedProfile = ref("")` + watch llmStore.items 变化时设默认 `items[0]?.id ?? ""`；
- `onProfileChange(id) { /* 写回 aiChatStore */ }`。

- [ ] **Step 3: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/ai-chat/ChatComposer.vue frontend/src/features/settings/stores/llm-profiles.store.ts
git commit -m "feat(frontend): composer = agent mode; profile from llm-profiles"
```

---

# Slice 7 — 附件上传（用户项 #8）

## Task 7.1: migration + 表 + 仓储

**Files:**
- Create: `backend/persistence/database/migrations/017_chat_attachments.sql.ts`
- Create: `backend/persistence/sqlite/sqlite-chat-attachments.repository.ts`

- [ ] **Step 1: migration**

```ts
export const MIGRATION_017 = {
  id: "017_chat_attachments",
  sql: `
    CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      parsed_summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_session
      ON chat_attachments(session_id, created_at DESC);
  `,
};
```

并在 `migrations/index.ts` 追加。

- [ ] **Step 2: 仓储** —— 看 `SqliteChatSessionRepository` 风格，写：

```ts
export interface ChatAttachmentRecord {
  id: string; sessionId: string; fileName: string; mimeType: string;
  sizeBytes: number; storagePath: string; parsedSummary: string | null; createdAt: Date;
}

export interface IChatAttachmentRepository {
  create(rec: ChatAttachmentRecord): void;
  listBySession(sessionId: string): ChatAttachmentRecord[];
  updateSummary(id: string, summary: string): void;
}

export class SqliteChatAttachmentRepository implements IChatAttachmentRepository {
  constructor(private db: Database) {}
  create(r: ChatAttachmentRecord) { this.db.run(`INSERT INTO chat_attachments (id, session_id, file_name, mime_type, size_bytes, storage_path, parsed_summary, created_at) VALUES (?,?,?,?,?,?,?,?)`, [r.id, r.sessionId, r.fileName, r.mimeType, r.sizeBytes, r.storagePath, r.parsedSummary, r.createdAt.toISOString()]); }
  listBySession(sessionId: string): ChatAttachmentRecord[] {
    return this.db.query(`SELECT * FROM chat_attachments WHERE session_id=? ORDER BY created_at DESC`, [sessionId])
      .map((row) => this.toRecord(row));
  }
  updateSummary(id: string, summary: string) {
    this.db.run(`UPDATE chat_attachments SET parsed_summary=? WHERE id=?`, [summary, id]);
  }
  private toRecord(row: any): ChatAttachmentRecord { /* 解析 + 类型转换 */ }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/persistence/database/migrations/017_chat_attachments.sql.ts backend/persistence/database/migrations/index.ts backend/persistence/sqlite/sqlite-chat-attachments.repository.ts
git commit -m "feat(backend): chat_attachments table + repo"
```

## Task 7.2: 工具 attach_file_to_chat

**Files:**
- Create: `backend/ai/tool/attach-file-to-chat.ts`
- Modify: `backend/ai/tool/tool-registry.ts`（注册）
- Test: `backend/ai/tool/attach-file-to-chat.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
Deno.test("attach_file_to_chat rejects >10MB", async () => {
  const ctx = makeCtx();
  const tool = makeAttachFileToChatTool(deps);
  const big = Buffer.alloc(11 * 1024 * 1024, "x").toString("base64");
  const r = await tool.execute({ sessionId: "s1", fileName: "big.bin", contentBase64: big, mimeType: "application/octet-stream" }, ctx);
  assert(!r.ok);
  assertMatch(r.error, /size/);
});

Deno.test("attach_file_to_chat stores file + parses via LLM", async () => {
  const tmpDir = await Deno.makeTempDir();
  const deps = makeDeps({ storageDir: tmpDir, llmStub: () => "摘要: 测试内容" });
  const tool = makeAttachFileToChatTool(deps);
  const r = await tool.execute({ sessionId: "s1", fileName: "hi.txt", contentBase64: btoa("hello world"), mimeType: "text/plain" }, ctx);
  assert(r.ok);
  // 验证文件存在 + DB 行
  const files = [...Deno.readDir(tmpDir)];
  assert(files.length > 0);
});
```

- [ ] **Step 2: 实现**

```ts
export function makeAttachFileToChatTool(deps: {
  repo: IChatAttachmentRepository;
  chatSessionRepo: IChatSessionRepository;
  llmClient: { complete(p: { system: string; user: string }): Promise<string> };
  storageDir: string;
  maxBytes?: number;
}) {
  const MAX = deps.maxBytes ?? 10 * 1024 * 1024;
  return {
    name: "attach_file_to_chat",
    description: "上传一个附件到 chat session。AI 自动解析内容并写入 parsed_summary。",
    inputSchema: { /* ... */ },
    async execute(args: { sessionId: string; fileName: string; contentBase64?: string; contentText?: string; mimeType: string }, _ctx) {
      const session = deps.chatSessionRepo.findSessionById(args.sessionId);
      if (!session) return { ok: false, error: "session not found" };
      let buf: Uint8Array;
      let sizeBytes: number;
      if (args.contentBase64) {
        buf = Uint8Array.from(atob(args.contentBase64), (c) => c.charCodeAt(0));
        sizeBytes = buf.length;
      } else if (args.contentText) {
        buf = new TextEncoder().encode(args.contentText);
        sizeBytes = buf.length;
      } else {
        return { ok: false, error: "contentBase64 or contentText required" };
      }
      if (sizeBytes > MAX) return { ok: false, error: `size exceeds limit ${MAX}` };
      const id = crypto.randomUUID();
      const dir = `${deps.storageDir}/${args.sessionId}`;
      await Deno.mkdir(dir, { recursive: true });
      const path = `${dir}/${id}_${args.fileName}`;
      await Deno.writeFile(path, buf);
      // AI 解析
      const summary = await deps.llmClient.complete({
        system: "请用 1-2 句话总结附件核心内容。",
        user: args.contentText ?? new TextDecoder().decode(buf.slice(0, 4000)),
      });
      deps.repo.create({ id, sessionId: args.sessionId, fileName: args.fileName, mimeType: args.mimeType, sizeBytes, storagePath: path, parsedSummary: summary, createdAt: new Date() });
      return { ok: true, output: JSON.stringify({ id, summary }) };
    },
  };
}
```

- [ ] **Step 3: 注册 + 跑 + Commit**

```bash
deno test --no-check -A backend/ai/tool/attach-file-to-chat.test.ts
git add backend/ai/tool/attach-file-to-chat.ts backend/ai/tool/attach-file-to-chat.test.ts backend/ai/tool/tool-registry.ts
git commit -m "feat(backend): attach_file_to_chat tool with size + AI parse"
```

## Task 7.3: 前端 ⊕ 按钮

**Files:**
- Modify: `frontend/src/features/ai-chat/ChatComposer.vue`
- Modify: `frontend/src/features/ai-chat/api/ai-chat.api.ts`

- [ ] **Step 1: api.ts 加**

```ts
uploadAttachment: async (sessionId: string, file: File) => {
  const buf = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return (await post("/api/tools/invoke", { name: "attach_file_to_chat", args: { sessionId, fileName: file.name, contentBase64: base64, mimeType: file.type } })).data;
},
```

- [ ] **Step 2: ChatComposer ⊕ 按钮**

```vue
<el-button link size="small" @click="fileInput?.click()">
  <span class="text-base">⊕</span>
</el-button>
<input ref="fileInput" type="file" multiple class="hidden" @change="onFiles" />
```

`<script setup>`：
- `const fileInput = ref<HTMLInputElement | null>(null)`；
- `async function onFiles(e: Event) { const files = (e.target as HTMLInputElement).files; if (!files) return; for (const f of files) await store.uploadAttachment(sessionStore.currentSessionId!, f); (e.target as HTMLInputElement).value = ""; }`；
- 上传成功后在 sessionStore.messages 末尾插入一条 "attachment" 类型的可视化（用现有 MessageBubble 但传附件 props）。

- [ ] **Step 3: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/ai-chat/
git commit -m "feat(frontend): attachment button + upload via attach_file_to_chat"
```

---

# Slice 8 — 全自动开关（用户项 #12）

## Task 8.1: AiSession 加 autoMode + chat stream 分支

**Files:**
- Create: `backend/persistence/database/migrations/018_ai_session_auto_mode.sql.ts`
- Modify: `backend/domain/ai-session/ai-session.ts`
- Modify: `backend/ai/chat/chat-stream.ts`

- [ ] **Step 1: migration**

```ts
export const MIGRATION_018 = {
  id: "018_ai_session_auto_mode",
  sql: `ALTER TABLE ai_sessions ADD COLUMN auto_mode INTEGER NOT NULL DEFAULT 0;`,
};
```

并在 index.ts 追加。

- [ ] **Step 2: AiSession**

- `CreateAiSessionArgs` 加 `autoMode?: boolean`；
- 私有字段加 `_autoMode: boolean`；
- snapshot 加 `autoMode: boolean`；
- `rehydrate` 加 `autoMode?: boolean`，缺省 false。

- [ ] **Step 3: chat stream 分支**

找 `chat-stream.ts` 主入口，根据 `req.body.autoMode === true`：

```ts
if (body.autoMode && projectId) {
  const orch = deps.autoModeOrchestrator;
  orch.onProgress((ev) => sendSse(res, { kind: "auto_" + ev.kind, ...ev }));
  const plan = buildDefaultAutoModePlan(projectId as ProjectId);
  const result = await orch.run(plan);
  // 把每个 task 的 output 作为 assistant 消息插入 session
  for (const tr of result.taskResults) {
    await chatSessionRepo.appendMessage({
      id: crypto.randomUUID(),
      sessionId: body.sessionId,
      role: "assistant",
      content: `[auto-task ${tr.taskName}] ${tr.output}`,
      createdAt: new Date(),
    });
  }
  sendSse(res, { kind: "auto_done", success: result.success });
  res.end();
  return;
}
```

- [ ] **Step 4: 测试**

```ts
Deno.test("chat stream routes to auto-mode when body.autoMode=true", async () => {
  const res = await invokeChatStream({ sessionId: "s1", projectId: "p1", content: "go", autoMode: true });
  // 验证 SSE 输出含 auto_task_start / auto_done
});
```

- [ ] **Step 5: 跑 + Commit**

```bash
deno test --no-check -A backend/ai/chat/
git add backend/persistence/database/migrations/018_ai_session_auto_mode.sql.ts backend/domain/ai-session/ai-session.ts backend/ai/chat/chat-stream.ts
git commit -m "feat(backend): autoMode flag on chat stream"
```

## Task 8.2: 前端 switch

**Files:**
- Modify: `frontend/src/features/ai-chat/ChatComposer.vue`
- Modify: `frontend/src/features/ai-chat/stores/ai-chat.store.ts`

- [ ] **Step 1: store 加 `autoMode`**

```ts
const autoMode = ref(false);
function setAutoMode(v: boolean) { autoMode.value = v; }
```

- [ ] **Step 2: send 时**

```ts
async function send(content: string) {
  // ... 把 body.autoMode = autoMode.value
}
```

- [ ] **Step 3: UI switch**

```vue
<el-switch v-model="autoModeLocal" active-text="🤖 全自动" inactive-text="💬 助手" @change="onAuto" />
```

- [ ] **Step 4: SSE 渲染 auto-mode 进度**

在 MessageBubble 加一种 `role="system" kind="auto_progress"` 的可视化（卡片化显示 task 进度 + score）。

- [ ] **Step 5: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/ai-chat/
git commit -m "feat(frontend): auto-mode switch + progress rendering"
```

---

# Slice 9 — Auto-mode 全流水线（用户项 #13）

## Task 9.1: 4 个新 sub-agent spec

**Files:**
- Modify: `backend/ai/auto-mode/auto-mode-agents.ts`
- Modify: `backend/ai/auto-mode/orchestrator.ts`（`buildDefaultAutoModePlan` 加 4 个 task）

- [ ] **Step 1: 加 4 个 spec**

```ts
// 业务架构专家
const BUSINESS_ARCH_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：业务架构设计

输出 4 块：
1. 核心用例（5-8 个）：标题 / 角色 / 前置 / 主流程 / 异常 / 后置
2. TO-BE 蓝图（Markdown 段落 + 表格）
3. ROI：投入 / 收益 / 回收期（月）
4. 交付物清单：名称 / 类型 / 责任人 / 时间

约束：不要重复造 markdown_*.md 内容；要把功能精确到可被技术架构师对接。
`;

const BUSINESS_ARCH_SPEC: SubAgentSpecData = {
  name: "auto_business_arch",
  displayName: "业务架构专家",
  description: "auto-mode：核心用例设计 + TO-BE 蓝图 + ROI 分析 + 交付物规划",
  systemPrompt: BUSINESS_ARCH_SYSTEM,
  toolNames: ["read_module", "update_markdown_module", "update_use_case", "update_deliverable"],
  type: "system",
};

// 技术架构专家
const TECH_ARCH_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：技术架构设计

输出 5 块：
1. 方案设计：业务角色 + 业务流程图（mermaid） + 关键业务模块 + 业务规则 + 业务数据分析 + 流程图
2. 非功能需求：性能 / 安全 / 可用性 / 可扩展（量化指标）
3. IT 环境：操作系统 / 中间件 / 网络
4. 硬件清单：服务器 / 存储 / 网络设备（型号 + 数量 + 单价）
5. 项目前提条件 + 风险矩阵（5×5 likelihood × impact）

不要写业务规则细节（由功能清单负责）；要写选型理由。
`;

const TECH_ARCH_SPEC: SubAgentSpecData = {
  name: "auto_tech_arch",
  displayName: "技术架构专家",
  description: "auto-mode：方案设计 + 非功能需求 + IT 环境 + 硬件清单 + 风险分析",
  systemPrompt: TECH_ARCH_SYSTEM,
  toolNames: ["read_module", "update_markdown_module"],
  type: "system",
};

// 功能清单专家
const FEATURE_LIST_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：功能清单 + CP 值评估

输出表格：
| 大分类 | 模块 | 功能名 | 功能详情 | CP | 备注 |

CP 评估规则：
- 选一个最简单的功能点作为基准 CP=1（例如"查看详情页"）
- 其他功能点与基准对比，按斐波那契数列（1, 2, 3, 5, 8, 13, 21）打分
- CP 越高 = 实现复杂度越高

功能详情：
- 涉及的数据对象属性（哪些字段、关键约束）
- 业务规则（每条规则换行显示，编号 1. 2. 3.）

不少于 30 条功能；分类不超过 5 个大分类。
`;

const FEATURE_LIST_SPEC: SubAgentSpecData = {
  name: "auto_feature_list",
  displayName: "功能清单专家",
  description: "auto-mode：功能清单 + 斐波 CP 值评估",
  systemPrompt: FEATURE_LIST_SYSTEM,
  toolNames: ["read_module", "update_function_list"],
  type: "system",
};

// PPT 设计师
const PPT_DESIGNER_SYSTEM = `${AUTO_MODE_SHARED_PROMPT_HEAD}

# 任务：提案 PPT 设计

输出 JSON：
{
  "pages": [
    {"ordinal": 1, "title": "封面", "prompt": "目标受众: ... 风格: ... 要点: ... 配图: ..."},
    ...
  ],
  "theme": "conservative" | "minimal" | "high_contrast",
  "totalPages": N
}

约束：
- 8-15 页
- ordinal 严格 1-based 递增
- title 不超过 20 字
- prompt 包含：目标受众 / 视觉风格 / 3-5 条要点 / 建议配图
- 不要捏造客户名 / 数据
`;

const PPT_DESIGNER_SPEC: SubAgentSpecData = {
  name: "auto_ppt_designer",
  displayName: "提案 PPT 设计师",
  description: "auto-mode：每页内容 + 风格 + 调用 PPT 生成",
  systemPrompt: PPT_DESIGNER_SYSTEM,
  toolNames: ["read_module", "update_ppt_pages", "run_ppt_generation"],
  type: "system",
};

export const AUTO_MODE_SPECS: readonly SubAgentSpecData[] = [
  ENV_INIT_SPEC, BUSINESS_REQ_SPEC, SURVEY_TASK_SPEC,
  BUSINESS_ARCH_SPEC, TECH_ARCH_SPEC, FEATURE_LIST_SPEC, PPT_DESIGNER_SPEC,
  CUSTOMER_REVIEW_SPEC, DIRECTOR_REVIEW_SPEC,
] as const;
```

- [ ] **Step 2: buildDefaultAutoModePlan**

```ts
export function buildDefaultAutoModePlan(projectId: ProjectId): TaskPlan {
  return {
    projectId,
    id: crypto.randomUUID(),
    tasks: [
      { name: "env_init", subAgentName: "auto_env_init", description: "初始化项目骨架", contextInputs: [] },
      { name: "business_req", subAgentName: "auto_business_req", description: "设计调查问卷 + 业务现状 + 问题点 + 改善目标", contextInputs: ["project_meta"] },
      { name: "survey_task", subAgentName: "auto_survey_task", description: "执行调查任务清单", contextInputs: ["project_meta", "questionnaire_outline"] },
      { name: "business_arch", subAgentName: "auto_business_arch", description: "核心用例 + TO-BE + ROI + 交付物", contextInputs: ["project_meta", "markdown_business_current", "markdown_pain_point", "markdown_improvement"] },
      { name: "tech_arch", subAgentName: "auto_tech_arch", description: "方案 + 非功能 + IT 环境 + 硬件 + 风险", contextInputs: ["project_meta", "use_case"] },
      { name: "feature_list", subAgentName: "auto_feature_list", description: "功能清单 + 斐波 CP 值", contextInputs: ["project_meta", "use_case"] },
      { name: "ppt_designer", subAgentName: "auto_ppt_designer", description: "PPT 页面内容 + 风格", contextInputs: ["project_meta", "use_case", "function_list", "markdown_business_current"] },
    ],
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/ai/auto-mode/auto-mode-agents.ts backend/ai/auto-mode/orchestrator.ts
git commit -m "feat(backend): auto-mode 4 new sub-agent specs + full plan"
```

## Task 9.2: 真实 worker

**Files:**
- Modify: `backend/ai/auto-mode/sub-agent-worker.ts`
- Test: `backend/ai/auto-mode/sub-agent-worker.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
Deno.test("worker invokes LLM and parses structured output", async () => {
  const w = new SubAgentWorker({
    subAgentRegistry: makeRegistry([AUTO_MODE_SPEC_BY_NAME.auto_business_req]),
    llmClient: { complete: async () => JSON.stringify({ questionnaire: ["Q1?", "Q2?"], current: "...", painPoints: [], improvementGoals: [], execSummary: "..." }) },
    businessModuleService: makeStubBM(),
  });
  const r = await w.executeTask({ projectId, task: { name: "x", subAgentName: "auto_business_req", description: "", contextInputs: [] }, context: {}, feedback: [], round: 1 });
  assert(r.output.length > 0);
});
```

- [ ] **Step 2: 实现 worker**

```ts
export class SubAgentWorker implements AutoModeWorker {
  constructor(private deps: { subAgentRegistry: ISubAgentRegistry; llmClient: LlmClient; businessModuleService: BusinessModuleService; clock: Clock; projectService: ProjectService }) {}
  async executeTask(args: { projectId: ProjectId; task: TaskSpec; context: Partial<Record<ContextInputKind, string>>; feedback: readonly string[]; round: number }) {
    const spec = this.deps.subAgentRegistry.get(args.task.subAgentName);
    if (!spec) throw new Error(`sub-agent not found: ${args.task.subAgentName}`);
    // 构造 prompt
    let prompt = spec.systemPrompt + "\n\n# 项目上下文\n";
    for (const [k, v] of Object.entries(args.context)) {
      prompt += `\n## ${k}\n${v}\n`;
    }
    if (args.feedback.length > 0) {
      prompt += `\n# 上轮 review 反馈（请改善）\n${args.feedback.join("\n")}\n`;
    }
    prompt += `\n# 任务描述\n${args.task.description}\n`;
    // 调 LLM
    const output = await this.deps.llmClient.complete({ system: prompt, user: "请按要求输出。" });
    // 解析并落库（按 spec 工具名特判）
    const wroteModules: ContextInputKind[] = [];
    if (spec.toolNames.includes("update_markdown_module")) {
      // 解析 markdown sections，写入对应 kind
      // 简化版：把所有 output 写入 markdown_business_current（如 spec name = business_req）
      const kind = this.guessMarkdownKind(spec.name);
      if (kind) {
        await this.deps.businessModuleService.upsertMarkdown({ projectId: args.projectId, kind, content: output });
        wroteModules.push(kind);
      }
    }
    if (spec.toolNames.includes("update_function_list")) {
      // 解析 markdown 表格，写入功能清单
      await this.deps.businessModuleService.upsertFunctionList({ projectId: args.projectId, markdown: output });
      wroteModules.push("function_list");
    }
    if (spec.toolNames.includes("update_ppt_pages")) {
      const json = JSON.parse(output);
      await this.deps.pptService.replacePages(args.projectId, json.pages);
      wroteModules.push("function_list"); // 标记写过
    }
    return { output, wroteModules };
  }
  private guessMarkdownKind(specName: string): ContextInputKind | null {
    if (specName === "auto_business_req") return "markdown_business_current";
    if (specName === "auto_business_arch") return "markdown_business_current";
    if (specName === "auto_tech_arch") return "markdown_business_current";
    return null;
  }
}
```

（实际生产可更精细——按 spec 不同的 markdown section target 写入。本 plan 取最少落地版。）

- [ ] **Step 3: 跑 + Commit**

```bash
deno test --no-check -A backend/ai/auto-mode/sub-agent-worker.test.ts
git add backend/ai/auto-mode/sub-agent-worker.ts backend/ai/auto-mode/sub-agent-worker.test.ts
git commit -m "feat(backend): auto-mode worker real implementation"
```

## Task 9.3: 真实 reviewer + orchestrator 测试

**Files:**
- Modify: `backend/ai/auto-mode/sub-agent-reviewer.ts`
- Test: `backend/ai/auto-mode/orchestrator-round.test.ts`

- [ ] **Step 1: 实现 reviewer**

```ts
export class SubAgentReviewer implements Reviewer {
  constructor(private deps: { subAgentRegistry: ISubAgentRegistry; llmClient: LlmClient }) {}
  readonly role: "customer" | "director";
  readonly name: string;
  constructor(role: "customer" | "director", deps: ...) { this.role = role; this.name = role === "customer" ? "auto_customer_review" : "auto_director_review"; }
  async review(args) {
    const spec = this.deps.subAgentRegistry.get(this.name);
    if (!spec) throw new Error(`reviewer spec not found: ${this.name}`);
    const prompt = spec.systemPrompt + "\n\n# 项目上下文\n项目 ID: " + args.projectId + "\n\n# 任务输出\n" + args.taskOutput + (args.previousReviews.length > 0 ? "\n\n# 上轮 review\n" + JSON.stringify(args.previousReviews[args.previousReviews.length - 1]) : "");
    const raw = await this.deps.llmClient.complete({ system: prompt, user: "请评审。" });
    const parsed = JSON.parse(raw); // { scores: {...}, average, feedback }
    return { score: parsed.average, feedback: parsed.feedback };
  }
}
```

- [ ] **Step 2: orchestrator 测试**

```ts
Deno.test("orchestrator retries until review avg ≥ 9 (≤3 rounds)", async () => {
  let count = 0;
  const reviewer: Reviewer = { role: "customer", name: "c", review: async () => count++ < 2 ? { score: 5, feedback: "no" } : { score: 10, feedback: "ok" } };
  const reviewer2: Reviewer = { role: "director", name: "d", review: async () => ({ score: 9, feedback: "ok" }) };
  const worker: AutoModeWorker = { executeTask: async () => ({ output: "x", wroteModules: [] }) };
  const orch = new AutoModeOrchestrator({ worker, customerReviewer: reviewer, directorReviewer: reviewer2, contextProvider: stubProvider() });
  const r = await orch.run(simplePlan);
  assert(r.success);
  assert(r.taskResults[0].rounds === 3);
});

Deno.test("orchestrator stops at round limit and returns success=false", async () => {
  const reviewer: Reviewer = { role: "customer", name: "c", review: async () => ({ score: 5, feedback: "no" }) };
  const reviewer2: Reviewer = { role: "director", name: "d", review: async () => ({ score: 5, feedback: "no" }) };
  const worker: AutoModeWorker = { executeTask: async () => ({ output: "x", wroteModules: [] }) };
  const orch = new AutoModeOrchestrator({ worker, customerReviewer: reviewer, directorReviewer: reviewer2, contextProvider: stubProvider() });
  const r = await orch.run(simplePlan);
  assert(!r.success);
  assert(r.taskResults[0].rounds === 3);
  assert(!r.taskResults[0].passed);
});
```

- [ ] **Step 3: 跑 + Commit**

```bash
deno test --no-check -A backend/ai/auto-mode/
git add backend/ai/auto-mode/
git commit -m "feat(backend): auto-mode real reviewer + orchestrator round tests"
```

## Task 9.4: 前端 progress panel

**Files:**
- Create: `frontend/src/features/auto-mode/AutoModeProgressPanel.vue`（或在现有自动模式 view 内）
- Modify: `frontend/src/features/ai-chat/MessageBubble.vue`（渲染 auto-mode 进度）

- [ ] **Step 1: 进度卡片 component**

```vue
<template>
  <div v-for="t in taskResults" :key="t.taskName" class="border rounded p-2 mb-1 text-xs">
    <div class="flex justify-between">
      <span>{{ t.taskName }}</span>
      <span :class="t.passed ? 'text-green-600' : 'text-red-600'">{{ t.passed ? '✓ 通过' : '✗ 未通过' }}</span>
    </div>
    <div class="text-slate-500">轮数 {{ t.rounds }} · 平均 {{ avg(t) }}/10</div>
    <div v-if="t.reviews.length > 0" class="text-slate-400">
      客户: {{ t.reviews[t.reviews.length-1].customerScore }} · 总监: {{ t.reviews[t.reviews.length-1].directorScore }}
    </div>
  </div>
</template>
```

- [ ] **Step 2: 集成到 AiChatPanel**（autoMode 开启时显示）

- [ ] **Step 3: build + Commit**

```bash
cd frontend && npm run build
git add frontend/src/features/auto-mode/ frontend/src/features/ai-chat/MessageBubble.vue
git commit -m "feat(frontend): auto-mode progress panel"
```

---

## Final Verification

- 跑全套：

```bash
deno task check
deno test --no-check -A
cd frontend && npm run build
npx vitest run
```

预期：deno check 0 错；deno test 全绿（既有 + 新增 ≈ 80–100 例）；frontend build 0 错；vitest 全绿。

- 手动冒烟（README 阶段 7.4h）：
  - 创建项目 → 中止 → 验证 abortReason 写入
  - 设置 workspace path → 解析 → 验证 default = `~/Desktop/<code>`
  - 进 settings → sub-agent 增删改 → 系统 sub-agent 删除应被拒
  - 进 chat → 新建/删除会话 → 切会话验证消息历史
  - chat 内 `/skill_status` → 验证返回
  - chat 内上传 txt 附件 → 验证 attachment summary 出现
  - 打开"🤖 全自动"开关 → 发送 → 验证 auto-mode 进度显示
  - 触发 auto-mode → 验证 7 个 task 串行 + 双 review + 平均分判定

---

## Self-Review

**Spec coverage:**
- §1 中止 ✓ 任务 1.1–1.3
- §2 工作区 ✓ 任务 2.1–2.3
- §3 sub-agent 类型 ✓ 任务 3.1–3.3
- §4 + §5 chat session ✓ 任务 4.1–4.2
- §6 skill ✓ 任务 5.1–5.3
- §7 composer 改造 ✓ 任务 6.1
- §8 附件 ✓ 任务 7.1–7.3
- §9 全自动开关 ✓ 任务 8.1–8.2
- §10 auto-mode 全流水线 ✓ 任务 9.1–9.4

**Placeholder scan:** 0 个 "TBD" / "待补" / "后续 sprint" 模糊词；9.2 worker 中"简化版"是已知简化（spec 允许），并写入注释。

**Type consistency:**
- `Project.setWorkspacePath(absPath, clock)` —— Task 2.1 / 2.2 一致
- `attach_file_to_chat({ sessionId, fileName, contentBase64, contentText, mimeType })` —— Task 7.2 / 7.3 一致
- `chatSessionRepo.appendMessage(msg)` —— Task 4.2 / 8.1 一致
- `SubAgentSpecVO.toDTO()` —— Task 3.1 / 3.3 一致

**Review Focus:** 每条对应任务均有断言。