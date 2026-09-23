/**
 * SnapshotRegistry 单元测试
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { ProjectId as toProjectId, newId } from "@shared/types/ids.ts";
import {
  type BusinessModuleSnapshotProvider,
  type ContextFragment,
  SnapshotRegistry,
} from "@backend/ai/context/snapshot-registry.ts";

class FakeModule implements BusinessModuleSnapshotProvider {
  constructor(
    public readonly moduleName: string,
    private readonly score: number,
    private readonly summaryText: string,
  ) {}
  scoreRelevance(_input: { projectId: ReturnType<typeof toProjectId>; userInput: string }): Promise<number> {
    return Promise.resolve(this.score);
  }
  summarize(_input: { projectId: ReturnType<typeof toProjectId>; maxTokens: number }): Promise<ContextFragment | null> {
    return Promise.resolve({
      source: this.moduleName,
      projectId: null,
      title: this.moduleName,
      content: this.summaryText,
    });
  }
}

const pid = () => toProjectId(newId<"ProjectId">());

Deno.test("SnapshotRegistry —— registerModule + listModules", () => {
  const r = new SnapshotRegistry();
  r.registerModule(new FakeModule("痛点", 0.5, ""));
  r.registerModule(new FakeModule("ROI", 0.7, ""));
  assertEquals([...r.listModules()].sort(), ["ROI", "痛点"]);
});

Deno.test("SnapshotRegistry —— 重复 register → 抛错", () => {
  const r = new SnapshotRegistry();
  r.registerModule(new FakeModule("x", 0, ""));
  assertRejects(async () => r.registerModule(new FakeModule("x", 0, "")));
});

Deno.test("SnapshotRegistry —— scoreAll 按 score 降序", async () => {
  const r = new SnapshotRegistry();
  r.registerModule(new FakeModule("a", 0.2, ""));
  r.registerModule(new FakeModule("b", 0.8, ""));
  r.registerModule(new FakeModule("c", 0.5, ""));
  const out = await r.scoreAll({ projectId: pid(), userInput: "q" });
  assertEquals(out.length, 3);
  assertEquals(out[0].module, "b");
  assertEquals(out[1].module, "c");
  assertEquals(out[2].module, "a");
});

Deno.test("SnapshotRegistry —— getProjectProvider 默认 null", () => {
  const r = new SnapshotRegistry();
  assertEquals(r.getProjectProvider(), null);
  assertEquals(r.getRagProvider(), null);
});