/**
 * /api/projects/:id/emails + attachments 路由集成测试
 *
 * 阶段 7.4e。覆盖：
 *   - contacts CRUD + isPrimary 唯一性
 *   - team-members CRUD
 *   - emails createDraft + list + get + send
 *   - addAttachment + listAttachments + download (bytes 一致)
 *   - 路径穿越阻断（`../../etc/passwd` 被消毒）
 *   - sent 之后 addAttachment → 409
 *   - project GET → 内嵌真实 contacts/teamMembers
 */

import { assert, assertEquals } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteProjectContactsRepository } from "@backend/persistence/sqlite/sqlite-project-contacts.repository.ts";
import { SqliteProjectTeamMembersRepository } from "@backend/persistence/sqlite/sqlite-project-team-members.repository.ts";
import { SqliteEmailRepository } from "@backend/persistence/sqlite/sqlite-email.repository.ts";
import { MailUseCase } from "@backend/application/mail/mail.usecase.ts";
import { FilesystemMailStorage } from "@backend/application/mail/mail.storage.ts";
import {
  handleEmail,
  type EmailRouteDeps,
} from "@backend/presentation/routes/email.route.ts";
import {
  handleProjectContacts,
  type ProjectContactsRouteDeps,
} from "@backend/presentation/routes/project-contacts.route.ts";
import { handleProjects } from "@backend/presentation/routes/project.route.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { ProjectId } from "@shared/types/ids.ts";

function makeLogger(): Logger {
  const sink = () => {};
  return {
    level: "info",
    child: () => makeLogger(),
    debug: sink,
    info: sink,
    warn: sink,
    error: sink,
  };
}

interface TestSetup {
  pid: ProjectId;
  mailDeps: EmailRouteDeps;
  contactsDeps: ProjectContactsRouteDeps;
  projectService: ProjectService;
  tmpRoot: string;
}

async function setup(): Promise<TestSetup> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-mail-rt-" });
  const db = new Database({
    paths: {
      root: tmpRoot,
      data: tmpRoot,
      logs: tmpRoot,
      vendor: tmpRoot,
      output: tmpRoot,
    },
    inMemory: true,
    skipExtensions: true,
  });
  await db.ready();
  const clock = new FixedClock(new Date("2026-09-22T00:00:00Z"));
  const projRepo = new SqliteProjectRepository(db);
  const contactsRepo = new SqliteProjectContactsRepository(db);
  const teamRepo = new SqliteProjectTeamMembersRepository(db);
  const projectService = new ProjectService({ repo: projRepo, contactsRepo, teamRepo, clock });
  const r = await projectService.createProject({ name: "mail-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const mailRepo = new SqliteEmailRepository(db);
  const storage = new FilesystemMailStorage(tmpRoot);
  const useCase = new MailUseCase({ repo: mailRepo, storage, clock, logger: makeLogger() });
  const logger = makeLogger();
  return {
    pid: r.value.id,
    mailDeps: { logger, useCase, clock },
    contactsDeps: { logger, contactsRepo, teamRepo, clock },
    projectService,
    tmpRoot,
  };
}

// ---------- 1. contacts CRUD + isPrimary 唯一性 ----------

Deno.test("contacts — POST/GET + isPrimary 切换", async () => {
  const { pid, contactsDeps } = await setup();
  const listPath = `/api/projects/${pid}/contacts`;
  // 初始空
  const emptyReq = new Request(`http://x${listPath}`, { method: "GET" });
  const emptyRes = await handleProjectContacts(emptyReq, contactsDeps, new URL(`http://x${listPath}`));
  assertEquals(emptyRes.status, 200);
  const emptyBody = await emptyRes.json() as { items: unknown[] };
  assertEquals(emptyBody.items.length, 0);

  // 创建主联系人
  const create1 = new Request(`http://x${listPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "张三", email: "z@x.com", isPrimary: true }),
  });
  const create1Res = await handleProjectContacts(create1, contactsDeps, new URL(`http://x${listPath}`));
  assertEquals(create1Res.status, 201);

  // 再建一个 → 默认非 primary
  const create2 = new Request(`http://x${listPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "李四", email: "l@x.com" }),
  });
  const create2Res = await handleProjectContacts(create2, contactsDeps, new URL(`http://x${listPath}`));
  assertEquals(create2Res.status, 201);

  // 列表应按 primary DESC 排序
  const listRes = await handleProjectContacts(
    new Request(`http://x${listPath}`, { method: "GET" }),
    contactsDeps,
    new URL(`http://x${listPath}`),
  );
  const list = await listRes.json() as { items: Array<{ name: string; isPrimary: boolean }> };
  assertEquals(list.items.length, 2);
  assertEquals(list.items[0].isPrimary, true);
  assertEquals(list.items[0].name, "张三");
  assertEquals(list.items[1].isPrimary, false);

  // 把李四设为 primary → 张三 自动取消
  const liSiId = (await create2Res.clone().json() as { id: string }).id;
  const updatePath = `/api/projects/${pid}/contacts/${liSiId}`;
  const updateReq = new Request(`http://x${updatePath}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isPrimary: true }),
  });
  const updateRes = await handleProjectContacts(updateReq, contactsDeps, new URL(`http://x${updatePath}`));
  assertEquals(updateRes.status, 200);

  const list2Res = await handleProjectContacts(
    new Request(`http://x${listPath}`, { method: "GET" }),
    contactsDeps,
    new URL(`http://x${listPath}`),
  );
  const list2 = await list2Res.json() as { items: Array<{ name: string; isPrimary: boolean }> };
  const primaryCount = list2.items.filter((c) => c.isPrimary).length;
  assertEquals(primaryCount, 1);
  assertEquals(list2.items[0].name, "李四");
});

// ---------- 2. team-members CRUD ----------

Deno.test("team-members — CRUD 闭环", async () => {
  const { pid, contactsDeps } = await setup();
  const listPath = `/api/projects/${pid}/team-members`;
  const createReq = new Request(`http://x${listPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "王五", email: "w@x.com" }),
  });
  const createRes = await handleProjectContacts(createReq, contactsDeps, new URL(`http://x${listPath}`));
  assertEquals(createRes.status, 201);
  const mid = (await createRes.json() as { id: string }).id;

  // GET 单条
  const getPath = `/api/projects/${pid}/team-members/${mid}`;
  const getRes = await handleProjectContacts(
    new Request(`http://x${getPath}`, { method: "GET" }),
    contactsDeps,
    new URL(`http://x${getPath}`),
  );
  assertEquals(getRes.status, 200);

  // PATCH
  const patchReq = new Request(`http://x${getPath}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "wang5@new.com" }),
  });
  const patchRes = await handleProjectContacts(patchReq, contactsDeps, new URL(`http://x${getPath}`));
  assertEquals(patchRes.status, 200);
  const patched = await patchRes.json() as { email: string };
  assertEquals(patched.email, "wang5@new.com");

  // DELETE
  const delRes = await handleProjectContacts(
    new Request(`http://x${getPath}`, { method: "DELETE" }),
    contactsDeps,
    new URL(`http://x${getPath}`),
  );
  assertEquals(delRes.status, 204);
});

// ---------- 3. emails createDraft + list ----------

Deno.test("emails — createDraft + list + get", async () => {
  const { pid, mailDeps } = await setup();
  const listPath = `/api/projects/${pid}/emails`;
  const url = new URL(`http://x${listPath}`);

  const createReq = new Request(`http://x${listPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: "测试邮件",
      body: "正文…",
      to: [{ name: "张三", email: "z@x.com" }],
      cc: [{ name: "王五", email: "w@x.com" }],
    }),
  });
  const createRes = await handleEmail(createReq, mailDeps, url);
  assertEquals(createRes.status, 201);
  const created = await createRes.json() as { id: string; status: string; subject: string };
  assertEquals(created.subject, "测试邮件");
  assertEquals(created.status, "draft");

  // GET list
  const listRes = await handleEmail(new Request(`http://x${listPath}`, { method: "GET" }), mailDeps, url);
  const listBody = await listRes.json() as { items: Array<{ id: string }> };
  assertEquals(listBody.items.length, 1);
  assertEquals(listBody.items[0].id, created.id);

  // GET single
  const onePath = `/api/projects/${pid}/emails/${created.id}`;
  const oneRes = await handleEmail(
    new Request(`http://x${onePath}`, { method: "GET" }),
    mailDeps,
    new URL(`http://x${onePath}`),
  );
  assertEquals(oneRes.status, 200);
});

// ---------- 4. send → status=sent + sentAt + .eml 文件存在 ----------

Deno.test("emails — send → status=sent + .eml 落盘", async () => {
  const { pid, mailDeps, tmpRoot } = await setup();
  const listPath = `/api/projects/${pid}/emails`;
  const url = new URL(`http://x${listPath}`);

  const createReq = new Request(`http://x${listPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "hi", body: "body", to: [{ email: "a@b.com" }] }),
  });
  const createRes = await handleEmail(createReq, mailDeps, url);
  const created = await createRes.json() as { id: string };
  const eid = created.id;

  const sendPath = `/api/projects/${pid}/emails/${eid}/send`;
  const sendReq = new Request(`http://x${sendPath}`, { method: "POST" });
  const sendRes = await handleEmail(sendReq, mailDeps, new URL(`http://x${sendPath}`));
  assertEquals(sendRes.status, 200);
  const sent = await sendRes.json() as { status: string; sentAt: string | null };
  assertEquals(sent.status, "sent");
  assert(sent.sentAt !== null);

  // .eml 文件存在
  const emlPath = `${tmpRoot}/projects/${pid}/sent-emails/${eid}.eml`;
  const stat = await Deno.stat(emlPath);
  assert(stat.isFile);

  // 文件内容包含 subject
  const txt = await Deno.readTextFile(emlPath);
  assert(txt.includes("hi"));
});

// ---------- 5. send 非 draft → 409 ----------

Deno.test("emails — 重复 send → 409", async () => {
  const { pid, mailDeps } = await setup();
  const listPath = `/api/projects/${pid}/emails`;
  const url = new URL(`http://x${listPath}`);
  const createRes = await handleEmail(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "x", body: "y" }),
    }),
    mailDeps,
    url,
  );
  const eid = (await createRes.json() as { id: string }).id;

  const sendPath = `/api/projects/${pid}/emails/${eid}/send`;
  const first = await handleEmail(
    new Request(`http://x${sendPath}`, { method: "POST" }),
    mailDeps,
    new URL(`http://x${sendPath}`),
  );
  assertEquals(first.status, 200);

  const second = await handleEmail(
    new Request(`http://x${sendPath}`, { method: "POST" }),
    mailDeps,
    new URL(`http://x${sendPath}`),
  );
  assertEquals(second.status, 409);
});

// ---------- 6. addAttachment + list + download（bytes 一致）----------

Deno.test("attachments — 上传 + 列表 + 下载字节一致", async () => {
  const { pid, mailDeps } = await setup();
  const listPath = `/api/projects/${pid}/emails`;
  const url = new URL(`http://x${listPath}`);
  const createRes = await handleEmail(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "att", body: "" }),
    }),
    mailDeps,
    url,
  );
  const eid = (await createRes.json() as { id: string }).id;

  const attPath = `/api/projects/${pid}/emails/${eid}/attachments`;
  const formData = new FormData();
  const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
  formData.append("file", new File([fileBytes], "test.bin", { type: "application/octet-stream" }));
  const uploadRes = await handleEmail(
    new Request(`http://x${attPath}`, { method: "POST", body: formData }),
    mailDeps,
    new URL(`http://x${attPath}`),
  );
  assertEquals(uploadRes.status, 201);
  const att = await uploadRes.json() as { id: string; filename: string; size: number };
  // filename 是消毒后形态：时间戳前缀 + 原名
  assert(att.filename.endsWith("test.bin"));
  assertEquals(att.size, 5);

  // 列表
  const listRes = await handleEmail(
    new Request(`http://x${attPath}`, { method: "GET" }),
    mailDeps,
    new URL(`http://x${attPath}`),
  );
  const list = await listRes.json() as { items: Array<{ id: string }> };
  assertEquals(list.items.length, 1);

  // 下载
  const dlPath = `/api/projects/${pid}/emails/${eid}/attachments/${att.id}`;
  const dlRes = await handleEmail(
    new Request(`http://x${dlPath}`, { method: "GET" }),
    mailDeps,
    new URL(`http://x${dlPath}`),
  );
  assertEquals(dlRes.status, 200);
  const dlBytes = new Uint8Array(await dlRes.arrayBuffer());
  assertEquals(dlBytes.length, 5);
  assertEquals(dlBytes[0], 1);
  assertEquals(dlBytes[4], 5);
});

// ---------- 7. 路径穿越阻断（`../../etc/passwd` 被消毒）----------

Deno.test("attachments — 路径穿越被消毒（点号 + 斜杠）", async () => {
  const { pid, mailDeps } = await setup();
  const listPath = `/api/projects/${pid}/emails`;
  const url = new URL(`http://x${listPath}`);
  const createRes = await handleEmail(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "traversal", body: "" }),
    }),
    mailDeps,
    url,
  );
  const eid = (await createRes.json() as { id: string }).id;

  const attPath = `/api/projects/${pid}/emails/${eid}/attachments`;
  const formData = new FormData();
  // 前端 file.name = 客户端可控；后端必须消毒
  formData.append("file", new File([new Uint8Array([7])], "../../../etc/passwd.txt"));
  const uploadRes = await handleEmail(
    new Request(`http://x${attPath}`, { method: "POST", body: formData }),
    mailDeps,
    new URL(`http://x${attPath}`),
  );
  assertEquals(uploadRes.status, 201);
  const att = await uploadRes.json() as { filename: string; id: string };
  // filename 在响应中必须是消毒后形态（不允许 `../` 透传到前端）
  assertEquals(att.filename.includes(".."), false);
  assertEquals(att.filename.includes("/"), false);
  assertEquals(att.filename.includes("\\"), false);
  assert(att.filename.endsWith("etc_passwd.txt"));

  // 下载应当成功（落盘路径已消毒，文件可读）
  const dlPath = `/api/projects/${pid}/emails/${eid}/attachments/${att.id}`;
  const dlRes = await handleEmail(
    new Request(`http://x${dlPath}`, { method: "GET" }),
    mailDeps,
    new URL(`http://x${dlPath}`),
  );
  assertEquals(dlRes.status, 200);
});

// ---------- 8. sent 之后 addAttachment → 409 ----------

Deno.test("attachments — sent 之后 addAttachment → 409", async () => {
  const { pid, mailDeps } = await setup();
  const listPath = `/api/projects/${pid}/emails`;
  const url = new URL(`http://x${listPath}`);
  const createRes = await handleEmail(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "lock", body: "" }),
    }),
    mailDeps,
    url,
  );
  const eid = (await createRes.json() as { id: string }).id;

  // send
  const sendPath = `/api/projects/${pid}/emails/${eid}/send`;
  await handleEmail(
    new Request(`http://x${sendPath}`, { method: "POST" }),
    mailDeps,
    new URL(`http://x${sendPath}`),
  );

  // 再尝试上传附件
  const attPath = `/api/projects/${pid}/emails/${eid}/attachments`;
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array([1])], "after.bin"));
  const uploadRes = await handleEmail(
    new Request(`http://x${attPath}`, { method: "POST", body: formData }),
    mailDeps,
    new URL(`http://x${attPath}`),
  );
  assertEquals(uploadRes.status, 409);
});

// ---------- 9. project GET → 内嵌真实 contacts/teamMembers ----------

Deno.test("project GET — 包含真实 contacts/teamMembers", async () => {
  const { pid, contactsDeps, projectService } = await setup();
  const listPath = `/api/projects/${pid}/contacts`;
  await handleProjectContacts(
    new Request(`http://x${listPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "张三", email: "z@x.com", isPrimary: true }),
    }),
    contactsDeps,
    new URL(`http://x${listPath}`),
  );
  const tmPath = `/api/projects/${pid}/team-members`;
  await handleProjectContacts(
    new Request(`http://x${tmPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "王五", email: "w@x.com" }),
    }),
    contactsDeps,
    new URL(`http://x${tmPath}`),
  );

  // 现在 GET project
  const url = new URL(`http://x/api/projects/${pid}`);
  const projDeps = { logger: contactsDeps.logger, service: projectService };
  const res = await handleProjects(
    new Request(`http://x/api/projects/${pid}`, { method: "GET" }),
    projDeps,
    url,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    contacts: Array<{ name: string; isPrimary: boolean }>;
    teamMembers: Array<{ name: string }>;
  };
  assertEquals(body.contacts.length, 1);
  assertEquals(body.contacts[0].name, "张三");
  assertEquals(body.contacts[0].isPrimary, true);
  assertEquals(body.teamMembers.length, 1);
  assertEquals(body.teamMembers[0].name, "王五");
});