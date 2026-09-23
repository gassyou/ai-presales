/**
 * ContextAssembler 单元测试
 *
 * 用 stub providers 模拟 RAG / project-snapshot 路径；
 * 重点验证：
 *   - mention → rag 路径（已入库）
 *   - mention → snapshot 路径（未入库）
 *   - 业务模块按 score 排序 + Top-K
 *   - 历史超长 → 摘要压缩
 *   - 总预算边界
 */

import { assert, assertEquals } from "@std/assert";
import { ProjectId as toProjectId, newId } from "@shared/types/ids.ts";
import type { ProjectId } from "@shared/types/ids.ts";
import {
  type BusinessModuleSnapshotProvider,
  type ContextFragment,
  type ProjectSnapshotProvider,
  type RagProvider,
  SnapshotRegistry,
} from "@backend/ai/context/snapshot-registry.ts";
import { CharacterBasedTokenCounter } from "@backend/ai/context/token-counter.ts";
import { ContextAssembler, type Summarizer } from "@backend/ai/context/context-assembler.ts";
import type { CanonicalMessage } from "@backend/ai/message/canonical-message.ts";

const pid = (): ProjectId => toProjectId(newId<"ProjectId">());

class FakeModule implements BusinessModuleSnapshotProvider {
  constructor(
    public readonly moduleName: string,
    private readonly score: number,
    private readonly content: string,
  ) {}
  scoreRelevance(): Promise<number> {
    return Promise.resolve(this.score);
  }
  summarize(): Promise<ContextFragment | null> {
    return Promise.resolve({
      source: this.moduleName,
      projectId: null,
      title: this.moduleName,
      content: this.content,
    });
  }
}

class FakeRagProvider implements RagProvider {
  constructor(private readonly fragments: readonly ContextFragment[]) {}
  async retrieve(): Promise<readonly ContextFragment[]> {
    return this.fragments;
  }
}

class FakeProjectSnapshotProvider implements ProjectSnapshotProvider {
  constructor(private readonly summaryByPid: Map<string, ContextFragment>) {}
  async summarize(input: { projectId: ProjectId; maxTokens: number }): Promise<ContextFragment | null> {
    return this.summaryByPid.get(input.projectId) ?? null;
  }
  async resolveMentions(
    rawTokens: readonly string[],
  ): Promise<{ matched: Array<{ token: string; projectId: ProjectId }>; unmatched: string[] }> {
    return { matched: [], unmatched: [...rawTokens] };
  }
}

function makeRegistry(
  modules: readonly FakeModule[] = [],
  rag: FakeRagProvider | null = null,
  proj: FakeProjectSnapshotProvider | null = null,
): SnapshotRegistry {
  const r = new SnapshotRegistry();
  for (const m of modules) r.registerModule(m);
  if (rag) r.registerRagProvider(rag);
  if (proj) r.registerProjectProvider(proj);
  return r;
}

const baseConfig = { contextWindow: 200_000, maxOutputTokens: 8_192 };

function makeMessage(role: "user" | "assistant" | "system" | "tool", text: string): CanonicalMessage {
  return { role, content: [{ type: "text", text }] };
}

Deno.test("ContextAssembler —— 基础装配：无 project / 无 mention / 无模块", async () => {
  const reg = makeRegistry();
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const out = await assembler.assemble({
    baseSystemPrompt: "你是一个助手",
    userInput: "你好",
    recentMessages: [],
    budget: baseConfig,
    projectLookup: async () => null,
  });
  assert(out.systemPrompt.includes("你是一个助手"));
  assertEquals(out.messages.length, 1);
  assertEquals(out.messages[0].role, "user");
  assertEquals(out.sources.length, 0);
});

Deno.test("ContextAssembler —— @已入库项目 → RAG 路径（rag section 出现）", async () => {
  const projectId = pid();
  const ragFragments: ContextFragment[] = [{
    source: "rag",
    projectId,
    title: "项目 A 痛点",
    content: "客户反馈响应慢",
  }];
  const reg = makeRegistry([], new FakeRagProvider(ragFragments));
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    userInput: "请参考 @项目A",
    recentMessages: [],
    budget: baseConfig,
    projectLookup: async (token) => token === "项目A" ? { projectId, isIndexed: true } : null,
  });
  assert(out.systemPrompt.includes("知识库召回"));
  assert(out.systemPrompt.includes("客户反馈响应慢"));
  assertEquals(out.budgetUsage.bySection.ragHits !== undefined, true);
});

Deno.test("ContextAssembler —— @未入库项目 → Snapshot 降级（200 token 摘要）", async () => {
  const projectId = pid();
  const reg = makeRegistry(
    [],
    null,
    new FakeProjectSnapshotProvider(new Map([
      [projectId, { source: "mention", projectId, title: "项目 B", content: "B 的简要摘要" }],
    ])),
  );
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    userInput: "对比 @项目B",
    recentMessages: [],
    budget: baseConfig,
    projectLookup: async (token) => token === "项目B" ? { projectId, isIndexed: false } : null,
  });
  assert(out.systemPrompt.includes("被引用项目摘要"));
  assert(out.systemPrompt.includes("B 的简要摘要"));
  assertEquals(out.budgetUsage.bySection.projectContext !== undefined, true);
});

Deno.test("ContextAssembler —— 业务模块按 score > 0.2 取 Top-4", async () => {
  const projectId = pid();
  const reg = makeRegistry([
    new FakeModule("痛点", 0.9, "痛点内容"),
    new FakeModule("ROI", 0.5, "ROI 内容"),
    new FakeModule("噪声", 0.1, "噪声内容"),  // 应被过滤
    new FakeModule("方案", 0.3, "方案内容"),
  ]);
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    userInput: "现状分析",
    recentMessages: [],
    budget: baseConfig,
    projectLookup: async () => null,
    projectId,
  });
  // "噪声" score=0.1 应被过滤
  const moduleSources = out.sources.filter((s) => s.kind === "module");
  assertEquals(moduleSources.length, 3);
  assertEquals(moduleSources.find((s) => s.module === "噪声"), undefined);
});

Deno.test("ContextAssembler —— 历史超长 → 摘要压缩", async () => {
  const reg = makeRegistry();
  const summarizer: Summarizer = async (messages, _max) => {
    return `摘要: 共 ${messages.length} 条历史对话`;
  };
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: { contextWindow: 1_000, maxOutputTokens: 200 },  // 总预算 800
  });
  const longHistory: CanonicalMessage[] = [];
  for (let i = 0; i < 200; i++) {
    longHistory.push(makeMessage("user", "x".repeat(50)));
    longHistory.push(makeMessage("assistant", "y".repeat(50)));
  }
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    userInput: "问题",
    recentMessages: longHistory,
    budget: { contextWindow: 1_000, maxOutputTokens: 200 },
    projectLookup: async () => null,
    summarizer,
  });
  // 应出现 history summary
  const summaryMsg = out.messages.find((m) =>
    m.role === "system" && m.content.some((p) => p.type === "text" && p.text.includes("摘要"))
  );
  assert(summaryMsg !== undefined);
  // 全部 sources 中应有 history 类（暂未实现 source 类型，仅断言未超 budget 太多）
  assert(out.budgetUsage.used <= out.budgetUsage.total * 1.2);
});

Deno.test("ContextAssembler —— 历史未超 → 全部保留", async () => {
  const reg = makeRegistry();
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const recent: CanonicalMessage[] = [
    makeMessage("user", "你好"),
    makeMessage("assistant", "你好，有什么可以帮您？"),
  ];
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    userInput: "提案概要",
    recentMessages: recent,
    budget: baseConfig,
    projectLookup: async () => null,
  });
  // 没有 system summary
  const summaryMsg = out.messages.find((m) =>
    m.role === "system" && m.content.some((p) => p.type === "text" && p.text.includes("对话历史摘要"))
  );
  assertEquals(summaryMsg, undefined);
  // 完整保留 recent + user input
  assertEquals(out.messages.length, 3);
});

Deno.test("ContextAssembler —— sources 数组记录了所有来源", async () => {
  const projectId = pid();
  const reg = makeRegistry(
    [new FakeModule("痛点", 0.8, "痛点")],
    new FakeRagProvider([{ source: "rag", projectId, title: "t", content: "c" }]),
  );
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    projectId,
    userInput: "请参考 @项目X",
    recentMessages: [],
    budget: baseConfig,
    projectLookup: async () => ({ projectId, isIndexed: true }),
  });
  const kinds = out.sources.map((s) => s.kind);
  assert(kinds.includes("system"));
  assert(kinds.includes("rag"));
  assert(kinds.includes("module"));
});

Deno.test("ContextAssembler —— 无 token-counter exception：sources 不重复", async () => {
  const reg = makeRegistry();
  const assembler = new ContextAssembler({
    tokenCounter: new CharacterBasedTokenCounter(),
    registry: reg,
    config: baseConfig,
  });
  const out = await assembler.assemble({
    baseSystemPrompt: "sys",
    userInput: "无 mention 测试",
    recentMessages: [],
    budget: baseConfig,
    projectLookup: async () => null,
  });
  assertEquals(out.sources.length, 0);
});