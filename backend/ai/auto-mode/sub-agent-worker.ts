/**
 * SubAgentAutoModeWorker —— 阶段 12（任务 sprint 12）：真实 LLM-backed worker
 *
 * 调 SubAgentRunner 执行 task，收集所有 chunk 拼成 output。
 * 上轮 reviewer feedback 注入 history（让 sub-agent 知道怎么改）。
 *
 * 局限：
 *   - wroteModules 暂留 []（orchestrator 后续接 use case 把输出落库；MVP 不做）
 *   - toolNames 来自 spec.toolNames 调 ToolRegistry.toLLMTools()
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { SubAgentName, SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import type { SubAgentRunner } from "@backend/ai/sub-agent/sub-agent-runner.ts";
import type { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type {
  AutoModeWorker,
  ContextInputKind,
} from "@backend/domain/auto-mode/auto-mode.ts";

export interface SubAgentAutoModeWorkerDeps {
  readonly registry: ISubAgentRegistry;
  readonly runner: SubAgentRunner;
  readonly toolRegistry: ToolRegistry;
}

export class SubAgentAutoModeWorker implements AutoModeWorker {
  constructor(private readonly deps: SubAgentAutoModeWorkerDeps) {}

  async executeTask({
    projectId: _projectId,
    task,
    context,
    feedback,
    round,
  }: {
    projectId: ProjectId;
    task: { name: string; subAgentName: SubAgentName; description: string; contextInputs: readonly ContextInputKind[] };
    context: Readonly<Partial<Record<ContextInputKind, string>>>;
    feedback: readonly string[];
    round: number;
  }): Promise<{ output: string; wroteModules: readonly ContextInputKind[] }> {
    const spec = this.deps.registry.get(task.subAgentName);
    if (!spec) {
      throw new Error(`sub-agent not found: ${task.subAgentName}`);
    }
    const prompt = buildWorkerPrompt(task, context, feedback, round);
    const tools = this.deps.toolRegistry.toLLMTools().filter((t) =>
      spec.toolNames.includes(t.name)
    );

    let output = "";
    let lastError: string | undefined;
    for await (const ev of this.deps.runner.run({ spec, userInput: prompt, tools })) {
      if (ev.type === "chunk") {
        output += ev.delta;
      } else if (ev.type === "done") {
        // runner 正常结束；output 已收集
      } else if (ev.type === "error") {
        lastError = ev.message;
      }
    }
    if (lastError && output.length === 0) {
      output = `[worker error] ${lastError}`;
    }

    // MVP：wroteModules 留空（orchestrator 后续 splice）
    return { output, wroteModules: [] };
  }
}

/**
 * 把 task 描述 + context + feedback 拼成 user prompt。
 * 第一轮：任务描述 + 项目上下文 + "请开始"。
 * 后续轮：在末尾追加上轮 review 的反馈 + "请改进后再次输出"。
 */
function buildWorkerPrompt(
  task: { name: string; description: string; contextInputs: readonly ContextInputKind[] },
  context: Readonly<Partial<Record<ContextInputKind, string>>>,
  feedback: readonly string[],
  round: number,
): string {
  const lines: string[] = [];
  lines.push(`# 任务 ${task.name}`);
  lines.push("");
  lines.push(task.description);
  lines.push("");
  if (task.contextInputs.length > 0) {
    lines.push("## 项目上下文");
    for (const k of task.contextInputs) {
      const v = context[k];
      if (v) {
        lines.push(`### ${k}`);
        lines.push(v);
        lines.push("");
      }
    }
  }
  if (feedback.length > 0 && round > 1) {
    lines.push("## 上轮 review 反馈（请改进）");
    for (const f of feedback) {
      lines.push(f);
    }
    lines.push("");
  }
  lines.push("请开始。");
  return lines.join("\n");
}

/** 保留 SubAgentSpecVO 类型重导出以便他处用 */
export type { SubAgentSpecVO };