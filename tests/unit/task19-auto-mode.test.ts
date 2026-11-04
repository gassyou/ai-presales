/**
 * 任务 19（阶段 13 / PR #9）：auto-mode 全流水线 —— 测试
 *
 * 覆盖：
 *   - AutoModeRunnerAdapter: 同步返回 AsyncIterable，延迟 client 解析
 *   - main.ts: 注入 autoModeOrchestrator + autoModeRoute 到 createApp
 *   - main.ts: 构造 DefaultAutoModeContextProvider + SubAgentAutoModeWorker + SubAgentReviewer ×2
 *   - server.ts: /api/ai/auto-mode 路由分发（集成测试，老 task11 已覆盖；本文件做源码断言）
 *   - 前端 auto-mode UI（面板 / store / api）已整体删除，AIChatDock 不再挂载
 */

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { existsSync } from "node:fs";
import { AutoModeRunnerAdapter } from "@backend/ai/auto-mode/invoke-sub-agent-runner.adapter.ts";
import type { SubAgentRunInput } from "@backend/ai/sub-agent/sub-agent-runner.ts";
import type { StreamEvent } from "@backend/ai/message/canonical-message.ts";
import type { InvokeSubAgentUseCase } from "@backend/application/sub-agent/invoke-sub-agent.usecase.ts";
import type { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import { SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";

function makeFakeTool(name: string): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  return { name, description: `${name} desc`, inputSchema: { type: "object" } };
}

function fakeInvokeUseCase(opts: {
  delayMs?: number;
  yieldEvents?: () => AsyncIterable<StreamEvent>;
}): InvokeSubAgentUseCase {
  return {
    execute: (_args: unknown) => {
      const promise = (async () => {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        const gen = opts.yieldEvents?.();
        if (gen) return gen;
        // 默认返一条 chunk + done
        async function* defaultGen(): AsyncIterable<StreamEvent> {
          yield { type: "chunk", delta: "hello", messageId: "m1" };
          yield {
            type: "done",
            messageId: "m1",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return defaultGen();
      })();
      return promise;
    },
  } as unknown as InvokeSubAgentUseCase;
}

function fakeToolRegistry(): ToolRegistry {
  return {
    get: (n: string) => makeFakeTool(n),
    has: (_n: string) => true,
    list: () => [],
    names: () => [],
    register: () => {},
    toLLMTools: () => [],
  } as unknown as ToolRegistry;
}

function fakeSpec(name: string, toolNames: string[] = []): SubAgentSpecVO {
  // 用领域工厂造真 VO（SubAgentSpecVO 私有构造，不能拿普通对象冒充）
  const r = SubAgentSpecVO.create({
    name,
    displayName: name,
    description: name,
    systemPrompt: "spec-prompt",
    toolNames,
    type: "system",
  });
  assert(r.ok, `fake spec "${name}" 应合法`);
  if (!r.ok) throw new Error("fake spec");
  return r.value;
}

Deno.test({
  name: "t19 — AutoModeRunnerAdapter.run 同步返回 AsyncIterable，client 解析在第一次 next() 才发生",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let executeCalls = 0;
    let firstNextAt = 0;
    const invoke = {
      execute: (_args: unknown) => {
        executeCalls++;
        firstNextAt = Date.now();
        async function* gen(): AsyncIterable<StreamEvent> {
          yield { type: "chunk", delta: "ok", messageId: "m" };
          yield {
            type: "done",
            messageId: "m",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return Promise.resolve(gen());
      },
    } as unknown as InvokeSubAgentUseCase;
    const adapter = new AutoModeRunnerAdapter({
      invokeUseCase: invoke,
      toolRegistry: fakeToolRegistry(),
    });
    const iterable = adapter.run({
      spec: fakeSpec("auto_env_init", ["read_module"]),
      userInput: "go",
      tools: [makeFakeTool("read_module")],
    });
    // run() 同步返 iterable；execute 还没调
    assertEquals(executeCalls, 0, "execute should NOT fire until first iteration");
    const events: StreamEvent[] = [];
    for await (const ev of iterable) events.push(ev);
    assert(executeCalls >= 1, "execute must fire on iteration");
    assertEquals(events.length, 2);
    assertEquals(events[0].type, "chunk");
    assertEquals(events[1].type, "done");
  },
});

Deno.test({
  name: "t19 — AutoModeRunnerAdapter 把 spec.toolNames 透传给 execute()",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let captured: unknown = null;
    const invoke = {
      execute: (args: unknown) => {
        captured = args;
        async function* gen(): AsyncIterable<StreamEvent> {
          yield {
            type: "done",
            messageId: "m",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        }
        return Promise.resolve(gen());
      },
    } as unknown as InvokeSubAgentUseCase;
    const adapter = new AutoModeRunnerAdapter({
      invokeUseCase: invoke,
      toolRegistry: fakeToolRegistry(),
    });
    const iter = adapter.run({
      spec: fakeSpec("auto_business_req", ["read_module", "create_survey_task"]),
      userInput: "hi",
      tools: [makeFakeTool("read_module"), makeFakeTool("create_survey_task")],
    });
    // drain
    for await (const _ev of iter) { /* noop */ }
    const args = captured as { subAgentName: string; userInput: string; tools: { name: string }[] };
    assertEquals(args.subAgentName, "auto_business_req");
    assertEquals(args.userInput, "hi");
    assertEquals(args.tools.length, 2);
    assertEquals(args.tools[0].name, "read_module");
    assertEquals(args.tools[1].name, "create_survey_task");
  },
});

// ---- main.ts wiring ----

Deno.test({
  name: "t19 — main.ts 引入 auto-mode 模块 + 构造 orchestrator + 注入 server",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile("main.ts");
    assertStringIncludes(src, "AutoModeOrchestrator");
    assertStringIncludes(src, "DefaultAutoModeContextProvider");
    assertStringIncludes(src, "SubAgentAutoModeWorker");
    assertStringIncludes(src, "makeSubAgentReviewer");
    assertStringIncludes(src, "AutoModeRunnerAdapter");
    assertStringIncludes(src, "autoModeOrchestrator");
    // 注入到 createApp
    assertStringIncludes(src, "autoModeRoute:");
    assertStringIncludes(src, "orchestrator: autoModeOrchestrator");
  },
});

Deno.test({
  name: "t19 — server.ts 包含 /api/ai/auto-mode 路由分发（源码断言）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "backend/presentation/server.ts",
    );
    assertStringIncludes(src, "/api/ai/auto-mode");
    assertStringIncludes(src, "handleAutoMode");
    assertStringIncludes(src, "autoModeRoute?");
  },
});

// ---- frontend ----

// 阶段 11：前端 auto-mode UI（面板 / store / api）已整体移除 ——
// AIChatDock 在 583fe5c 起不再挂载 AutoModePanel，这三份文件成了没人引用的死代码。
// 后端 /api/ai/auto-mode 路由与 sub-agent 保留，供 API 调用方 / auto-mode sub-agent 使用。
Deno.test({
  name: "t19 — 前端 auto-mode 死代码已删除（面板 / store / api）",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => {
    for (
      const rel of [
        "frontend/src/features/auto-mode/stores/auto-mode.store.ts",
        "frontend/src/features/auto-mode/components/AutoModePanel.vue",
        "frontend/src/features/auto-mode/api/auto-mode.api.ts",
      ]
    ) {
      assertEquals(
        existsSync(`${Deno.cwd()}/${rel}`),
        false,
        `${rel} 应已删除`,
      );
    }
  },
});

Deno.test({
  name: "t19 — AIChatDock 不再挂载 AutoModePanel",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "frontend/src/app/shell/AIChatDock.vue",
    );
    assertFalse(
      src.includes("AutoModePanel"),
      "AIChatDock 不应再引用 AutoModePanel（前端 auto-mode UI 已移除）",
    );
  },
});

Deno.test({
  name: "t19 — AutoModeRunnerAdapter 文件存在且 asSubAgentRunner 导出",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const src = await Deno.readTextFile(
      "backend/ai/auto-mode/invoke-sub-agent-runner.adapter.ts",
    );
    assertStringIncludes(src, "class AutoModeRunnerAdapter");
    assertStringIncludes(src, "asSubAgentRunner");
    assertStringIncludes(src, "[Symbol.asyncIterator]");
  },
});
