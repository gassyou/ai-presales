/**
 * AI chat store 的会话竞态 —— 静态断言
 *
 * 背景（都是真实存在的竞态）：
 *   1. send() 里 fire-and-forget 地建 session：建 session 会重置
 *      currentSessionId 与 messages，导致刚上屏的 user 消息既没持久化又被抹掉。
 *   2. 切换 / 删除会话时不中断正在跑的流：旧流的 chunk 与落盘会写进新会话。
 *   3. 连续 send 时 inflightAbort 被覆盖，stop() 再也停不下前一个请求。
 *   4. 会话加载响应乱序回来时，迟到的响应覆盖新会话的消息。
 *
 * 前端没有单测 infra（见 task5-chat-sessions.test.ts 的说明），
 * 所以这里用源码断言把这些不变量钉住；行为改动要能同时通过 vue-tsc。
 */

import { assert, assertStringIncludes, assertFalse } from "@std/assert";
import { functionBody, readText } from "../helpers/read-source.ts";

const STORE = "frontend/src/features/ai-chat/stores/ai-chat.store.ts";

function store(): string {
  return readText(STORE);
}

Deno.test("race — send() 先 await 建 session，再上屏 user 消息", () => {
  const src = store();
  const body = functionBody(src, "async function send(");
  const createIdx = body.indexOf("createSessionForProject(");
  const userMsgIdx = body.indexOf("const userMsg: ChatMessage");
  assert(createIdx >= 0, "send() 应有建 session 的分支");
  assert(userMsgIdx > createIdx, "建 session 必须在 user 消息上屏之前");
  assertStringIncludes(body, "await createSessionForProject(");
  assertFalse(
    body.includes("void createSessionForProject("),
    "建 session 不能 fire-and-forget（否则 user 消息会被建 session 的清空抹掉）",
  );
});

Deno.test("race — send() 固定本次发送归属的 session 并传给 persistMessage", () => {
  const src = store();
  const body = functionBody(src, "async function send(");
  assertStringIncludes(body, "const targetSessionId = currentSessionId.value");
  assertStringIncludes(body, 'persistMessage("user", userMsg.content, undefined, targetSessionId)');
  assertStringIncludes(body, '"assistant",\n          asstContent,');
  // 落盘不再从 messages.value 里 find（会话被切走时那条消息已经不在了）
  assertFalse(
    body.includes('messages.value.find((m) => m.id === asstId)'),
    "assistant 落盘应读本地累加器，不能读 messages.value",
  );
});

Deno.test("race — send() 顶掉上一条在途请求", () => {
  const src = store();
  const body = functionBody(src, "async function send(");
  assertStringIncludes(body, "inflightAbort.abort()");
  // abort 必须在给 inflightAbort 赋新值之前
  const abortIdx = body.indexOf("inflightAbort.abort()");
  const assignIdx = body.indexOf("inflightAbort = abort;");
  assert(abortIdx >= 0 && assignIdx > abortIdx, "应先 abort 旧的再挂新的");
});

Deno.test("race — send() 的 finally 只清理属于自己的那次请求", () => {
  const src = store();
  const body = functionBody(src, "async function send(");
  const finallyIdx = body.indexOf("} finally {");
  assert(finallyIdx >= 0, "send() 应有 finally");
  const tail = body.slice(finallyIdx);
  assertStringIncludes(tail, "if (inflightAbort === abort) {");
  assertStringIncludes(tail, "loading.value = false;");
  // loading 必须在 if 之内（被顶掉的那次不能把新请求的 loading 清掉）
  const ifIdx = tail.indexOf("if (inflightAbort === abort) {");
  const loadingIdx = tail.indexOf("loading.value = false;");
  assert(loadingIdx > ifIdx, "loading 复位必须在归属判断之内");
});

Deno.test("race — 切 / 删会话前先停掉在途的流", () => {
  const src = store();
  for (
    const header of [
      "async function switchToSession(",
      "async function createSessionForProject(",
      "async function deleteCurrentSession(",
    ]
  ) {
    const body = functionBody(src, header);
    assertStringIncludes(body, "stop()");
  }
});

Deno.test("race — 会话加载用 epoch 挡住乱序响应", () => {
  const src = store();
  assertStringIncludes(src, "let sessionEpoch = 0;");
  const body = functionBody(src, "async function switchToSession(");
  assertStringIncludes(body, "const epoch = ++sessionEpoch;");
  assertStringIncludes(body, "if (epoch !== sessionEpoch) return;");
});

Deno.test("race — persistMessage 支持显式指定 session，且 null 不回退", () => {
  const src = store();
  const body = functionBody(src, "async function persistMessage(");
  assertStringIncludes(body, "sessionId?: string | null");
  assertStringIncludes(
    body,
    "sessionId !== undefined ? sessionId : currentSessionId.value",
    "显式 null 必须表示'本次发送没有会话'，不能回退到 currentSessionId",
  );
});
