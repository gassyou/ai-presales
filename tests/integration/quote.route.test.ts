/**
 * /api/projects/:id/quote + /quote-templates 集成测试
 *
 * 阶段 7.4f。
 *
 * 覆盖：
 *   - GET /quote → 实时派生
 *   - POST /quote/generate → 写盘 + 入库 quote_runs；下载 bytes 含 Excel magic
 *   - 模板为空 → 使用内置默认（首次启动 ensure）
 *   - GET /quote/runs/:runId/download → bytes 一致
 *   - 模板上传 + magic bytes 校验
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteBusinessModuleRepository } from "@backend/persistence/sqlite/sqlite-business-module.repository.ts";
import { BusinessModuleService } from "@backend/application/business-module/business-module.service.ts";
import { StructuredModulesUseCase } from "@backend/application/business-module/structured-modules.usecase.ts";
import { HardwareItemsUseCase } from "@backend/application/business-module/hardware-items.usecase.ts";
import { QuoteUseCase } from "@backend/application/quote/quote.usecase.ts";
import { FilesystemQuoteStorage } from "@backend/application/quote/quote.storage.ts";
import { ExceljsFiller } from "@backend/application/quote/exceljs-filler.ts";
import { SqliteQuoteRunsRepository } from "@backend/persistence/sqlite/sqlite-quote-runs.repository.ts";
import { SqliteQuoteTemplatesRepository } from "@backend/persistence/sqlite/sqlite-quote-templates.repository.ts";
import { handleQuote } from "@backend/presentation/routes/quote.route.ts";
import { handleQuoteTemplates } from "@backend/presentation/routes/quote-templates.route.ts";
import { handleHardwareItems } from "@backend/presentation/routes/hardware-items.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info", child: () => makeLogger(),
    debug: sink, info: sink, warn: sink, error: sink,
  };
}

interface Setup {
  pid: ProjectId;
  quoteDeps: import("@backend/presentation/routes/quote.route.ts").QuoteRouteDeps;
  templatesDeps: import("@backend/presentation/routes/quote-templates.route.ts").QuoteTemplatesRouteDeps;
  hwDeps: import("@backend/presentation/routes/hardware-items.route.ts").HardwareItemsRouteDeps;
  tmpRoot: string;
}

async function setup(): Promise<Setup> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-quote-rt-" });
  const db = new Database({
    paths: { root: tmpRoot, data: tmpRoot, logs: tmpRoot, vendor: tmpRoot, output: tmpRoot },
    inMemory: true,
    skipExtensions: true,
  });
  await db.ready();
  const clock = new FixedClock(new Date("2026-09-22T00:00:00Z"));
  const projRepo = new SqliteProjectRepository(db);
  const projSvc = new ProjectService({ repo: projRepo, clock });
  const r = await projSvc.createProject({ name: "quote-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");

  const bmService = new BusinessModuleService({ repo: new SqliteBusinessModuleRepository(db), clock });
  const sm = new StructuredModulesUseCase(bmService);
  const hwUseCase = new HardwareItemsUseCase(bmService, clock);
  const quoteStorage = new FilesystemQuoteStorage(tmpRoot);
  const runsRepo = new SqliteQuoteRunsRepository(db);
  const templatesRepo = new SqliteQuoteTemplatesRepository(db);
  const quoteUseCase = new QuoteUseCase({
    hardwareUseCase: hwUseCase,
    structuredModules: sm,
    projectRepo: projRepo,
    runsRepo,
    templatesRepo,
    storage: quoteStorage,
    filler: new ExceljsFiller(),
    clock,
    logger: makeLogger(),
  });
  return {
    pid: r.value.id,
    quoteDeps: { logger: makeLogger(), useCase: quoteUseCase },
    templatesDeps: { logger: makeLogger(), useCase: quoteUseCase, storage: quoteStorage },
    hwDeps: { logger: makeLogger(), useCase: hwUseCase },
    tmpRoot,
  };
}

Deno.test("quote — GET /quote 实时派生（空项目 → 软件/硬件 = 0）", async () => {
  const { pid, quoteDeps } = await setup();
  const path = `/api/projects/${pid}/quote`;
  const url = new URL(`http://x${path}`);
  const res = await handleQuote(
    new Request(`http://x${path}`, { method: "GET" }),
    quoteDeps, url,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    top: { totalCP: number };
    software: { subtotal: number };
    hardware: { subtotal: number };
    grandTotalExclTax: number;
  };
  assertEquals(body.top.totalCP, 0);
  assertEquals(body.software.subtotal, 0);
  assertEquals(body.hardware.subtotal, 0);
  // deployTraining 不归零（DEFAULT_BUDGET_SETTINGS.deployDays = 3, trainingDays = 5）
  // 故 grandTotalExclTax = 3*2000 + 5*2000 = 16000
  assertEquals(body.grandTotalExclTax, 16000);
});

Deno.test("quote — POST /quote/generate 写盘 + 入库 + magic bytes", async () => {
  const { pid, quoteDeps, hwDeps } = await setup();
  // 先加 1 个硬件
  const hwPath = `/api/projects/${pid}/hardware-items`;
  await handleHardwareItems(
    new Request(`http://x${hwPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "服务器", device: "S1", qty: 1, unitPrice: 1000 }),
    }),
    hwDeps, new URL(`http://x${hwPath}`),
  );
  // 生成
  const genPath = `/api/projects/${pid}/quote/generate`;
  const url = new URL(`http://x${genPath}`);
  const res = await handleQuote(
    new Request(`http://x${genPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userInput: "test generate" }),
    }),
    quoteDeps, url,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as { runId: string; filename: string; mimeType: string };
  assert(body.runId.length > 0);
  assertEquals(body.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  // 列出 runs
  const listPath = `/api/projects/${pid}/quote/runs`;
  const listRes = await handleQuote(
    new Request(`http://x${listPath}`, { method: "GET" }),
    quoteDeps, new URL(`http://x${listPath}`),
  );
  const list = await listRes.json() as { items: Array<{ id: string }> };
  assertEquals(list.items.length, 1);
  assertEquals(list.items[0].id, body.runId);

  // 下载
  const dlPath = `/api/projects/${pid}/quote/runs/${body.runId}/download`;
  const dlRes = await handleQuote(
    new Request(`http://x${dlPath}`, { method: "GET" }),
    quoteDeps, new URL(`http://x${dlPath}`),
  );
  assertEquals(dlRes.status, 200);
  assertEquals(dlRes.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = new Uint8Array(await dlRes.arrayBuffer());
  assert(bytes.byteLength > 1000);
  // xlsx magic bytes
  assertEquals(bytes[0], 0x50);
  assertEquals(bytes[1], 0x4b);
  assertEquals(bytes[2], 0x03);
  assertEquals(bytes[3], 0x04);
});

Deno.test("quote — templates 列表 + 上传 + magic bytes 校验", async () => {
  const { pid, templatesDeps } = await setup();
  // 列表（首次为空，0 个项目上传 + 0 个默认）
  const listPath = `/api/quote-templates?projectId=${pid}`;
  const listRes = await handleQuoteTemplates(
    new Request(`http://x${listPath}`, { method: "GET" }),
    templatesDeps, new URL(`http://x${listPath}`),
  );
  assertEquals(listRes.status, 200);
  const list = await listRes.json() as { items: unknown[] };
  assertEquals(list.items.length, 0);

  // 上传非法（非 xlsx magic bytes）
  const uploadPath = `/api/projects/${pid}/quote-templates`;
  const badForm = new FormData();
  badForm.append("file", new File([new Uint8Array([1, 2, 3])], "bad.xlsx"));
  const badRes = await handleQuoteTemplates(
    new Request(`http://x${uploadPath}`, { method: "POST", body: badForm }),
    templatesDeps, new URL(`http://x${uploadPath}`),
  );
  assertEquals(badRes.status, 400);

  // 上传合法 xlsx
  // 构造一个简单 xlsx：直接写 zip 不实际，这里用 Exceljs 生成
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1").getCell(1, 1).value = "hello";
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const xlsxBytes = new Uint8Array(buf);
  console.log("xlsx bytes first 4:", xlsxBytes[0], xlsxBytes[1], xlsxBytes[2], xlsxBytes[3], "len:", xlsxBytes.byteLength);
  const goodForm = new FormData();
  goodForm.append("file", new File([xlsxBytes], "template.xlsx"));
  const goodRes = await handleQuoteTemplates(
    new Request(`http://x${uploadPath}`, { method: "POST", body: goodForm }),
    templatesDeps, new URL(`http://x${uploadPath}`),
  );
  const errBody = goodRes.status !== 201 ? await goodRes.text() : "";
  assertEquals(goodRes.status, 201, `upload failed: ${errBody}`);
  const created = await goodRes.json() as { id: string; projectId: string };
  assertEquals(created.projectId, pid);

  // 列表现在有 1 个
  const listRes2 = await handleQuoteTemplates(
    new Request(`http://x${listPath}`, { method: "GET" }),
    templatesDeps, new URL(`http://x${listPath}`),
  );
  const list2 = await listRes2.json() as { items: Array<{ id: string }> };
  assertEquals(list2.items.length, 1);

  // 下载模板
  const dlPath = `/api/quote-templates/${created.id}`;
  const dlRes = await handleQuoteTemplates(
    new Request(`http://x${dlPath}`, { method: "GET" }),
    templatesDeps, new URL(`http://x${dlPath}`),
  );
  assertEquals(dlRes.status, 200);

  // 删除模板
  const delRes = await handleQuoteTemplates(
    new Request(`http://x${dlPath}`, { method: "DELETE" }),
    templatesDeps, new URL(`http://x${dlPath}`),
  );
  assertEquals(delRes.status, 204);
});

Deno.test("quote — POST /quote/draft AI 起草未接线 → 500", async () => {
  const { pid, quoteDeps } = await setup();
  const path = `/api/projects/${pid}/quote/draft`;
  const url = new URL(`http://x${path}`);
  const res = await handleQuote(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userInput: "test" }),
    }),
    quoteDeps, url,
  );
  // 未注入 aiGenerateMarkdown 回调 → 500
  assertEquals(res.status, 500);
});