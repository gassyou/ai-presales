/**
 * SubAgentReviewer —— 阶段 12（任务 sprint 12）：真实 LLM-backed reviewer
 *
 * 复用 SubAgentRunner，但 spec 必须是 review 类（auto_customer_review /
 * auto_director_review）。
 *
 * 输出解析：review sub-agent 的 systemPrompt 末尾要求 LLM 输出结构化
 * 形如 { "score": N, "feedback": "..." } 的 JSON（或末尾 JSON 块）。
 * 解析失败 → score=0 + raw text 作 feedback。
 */

import type { ProjectId } from "@shared/types/ids.ts";
import type { SubAgentName, SubAgentSpecVO } from "@backend/domain/sub-agent/sub-agent-spec.ts";
import type { ISubAgentRegistry } from "@backend/domain/sub-agent/sub-agent.registry.ts";
import type { SubAgentRunner } from "@backend/ai/sub-agent/sub-agent-runner.ts";
import type { ToolRegistry } from "@backend/ai/tool/tool-registry.ts";
import type {
  Reviewer,
  ReviewScore,
  TaskSpec,
} from "@backend/domain/auto-mode/auto-mode.ts";

export interface SubAgentReviewerDeps {
  readonly role: "customer" | "director";
  readonly name: string;
  /** 该 role 对应的 sub-agent 名（通常 "auto_customer_review" 或 "auto_director_review"） */
  readonly subAgentName: SubAgentName;
  readonly registry: ISubAgentRegistry;
  readonly runner: SubAgentRunner;
  readonly toolRegistry: ToolRegistry;
}

/** 解析 sub-agent 输出的 JSON 块（容错） */
interface ParsedReview {
  score: number;
  feedback: string;
}

export class SubAgentReviewer implements Reviewer {
  readonly role: "customer" | "director";
  readonly name: string;
  constructor(private readonly deps: SubAgentReviewerDeps) {
    this.role = deps.role;
    this.name = deps.name;
  }

  async review(args: {
    projectId: ProjectId;
    task: TaskSpec;
    previousReviews: readonly ReviewScore[];
    taskOutput: string;
  }): Promise<{ score: number; feedback: string }> {
    const spec = this.deps.registry.get(this.deps.subAgentName);
    if (!spec) {
      throw new Error(`reviewer sub-agent not found: ${this.deps.subAgentName}`);
    }
    const prompt = buildReviewerPrompt(args.task, args.taskOutput, args.previousReviews);
    const tools = this.deps.toolRegistry.toLLMTools().filter((t) =>
      spec.toolNames.includes(t.name)
    );

    let output = "";
    let errMsg: string | undefined;
    for await (const ev of this.deps.runner.run({ spec, userInput: prompt, tools })) {
      if (ev.type === "chunk") {
        output += ev.delta;
      } else if (ev.type === "error") {
        errMsg = ev.message;
      }
    }
    if (errMsg && output.length === 0) {
      // 评审失败：score=0，原因为 feedback
      return { score: 0, feedback: `[reviewer error] ${errMsg}` };
    }
    return parseReviewOutput(output);
  }
}

/**
 * 构造 reviewer prompt：任务名 + 上轮 taskOutput + 上轮 reviews。
 * prompt 末尾强约束输出 JSON 格式。
 */
function buildReviewerPrompt(
  task: TaskSpec,
  taskOutput: string,
  previousReviews: readonly ReviewScore[],
): string {
  const lines: string[] = [];
  lines.push(`# 评审任务 ${task.name}`);
  lines.push("");
  lines.push(`任务描述：${task.description}`);
  lines.push("");
  lines.push("## worker 产出（请评审）");
  lines.push("```");
  lines.push(taskOutput);
  lines.push("```");
  if (previousReviews.length > 0) {
    lines.push("");
    lines.push("## 上轮 review 记录（用于改进）");
    for (const r of previousReviews) {
      lines.push(`第 ${r.round} 轮：客户=${r.customerScore} 总监=${r.directorScore} 均分=${r.average.toFixed(1)}`);
      lines.push(`客户反馈：${r.customerFeedback}`);
      lines.push(`总监反馈：${r.directorFeedback}`);
    }
  }
  lines.push("");
  lines.push("## 请输出 JSON");
  lines.push("");
  lines.push("格式：");
  lines.push("```json");
  lines.push("{ \"score\": <0-10 的整数>, \"feedback\": \"<markdown 段落，含 1) 优势 2) 不足 3) 3 条具体改进建议>\" }");
  lines.push("```");
  lines.push("");
  lines.push("只输出 JSON（可附简短前言，但 JSON 必须在最末尾）。");
  return lines.join("\n");
}

/** 解析 reviewer 输出 —— 找末尾 JSON 块 + fallback */
function parseReviewOutput(raw: string): ParsedReview {
  // 1. 抓 ```json ... ``` 块
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let jsonText = "";
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    jsonText = m[1].trim();
  }
  // 2. fallback：直接找裸 JSON
  if (!jsonText) {
    const braceStart = raw.lastIndexOf("{");
    const braceEnd = raw.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonText = raw.slice(braceStart, braceEnd + 1);
    }
  }
  if (!jsonText) {
    return { score: 0, feedback: raw.slice(0, 200) || "(empty reviewer output)" };
  }
  try {
    const obj = JSON.parse(jsonText) as { score?: unknown; feedback?: unknown };
    const score = Number(obj.score);
    const feedback = typeof obj.feedback === "string" ? obj.feedback : jsonText;
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      return { score: 0, feedback: `invalid score in: ${jsonText.slice(0, 200)}` };
    }
    return { score, feedback };
  } catch (e) {
    return {
      score: 0,
      feedback: `[parse error] ${raw.slice(0, 200)} (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

/** 工厂：customer / director reviewer */
export function makeSubAgentReviewer(opts: {
  role: "customer" | "director";
  registry: ISubAgentRegistry;
  runner: SubAgentRunner;
  toolRegistry: ToolRegistry;
}): SubAgentReviewer {
  const subAgentName = opts.role === "customer"
    ? "auto_customer_review"
    : "auto_director_review";
  return new SubAgentReviewer({
    role: opts.role,
    name: `${opts.role}-llm`,
    subAgentName,
    registry: opts.registry,
    runner: opts.runner,
    toolRegistry: opts.toolRegistry,
  });
}