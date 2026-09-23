/**
 * Mail send + SMTP 集成测试 —— 阶段 7.4h
 *
 * 用 Deno.listen 起一个 fake SMTP server，验证：
 *   - 合法 send → status=sent
 *   - SMTP 拒连 → status=failed + errorMessage
 *   - mail account 缺失 → INVALID_INPUT
 *   - multi-account 显式 accountId → 用指定账号
 *   - multi-account isDefault → 用 default
 *   - 附件 send 成功
 *
 * SMTP 协议最小实现（不完整；只支持本次测试需要的命令）：
 *   - 220 banner
 *   - EHLO → 250 OK + capabilities
 *   - AUTH LOGIN → 334 → base64 username → 334 → base64 password → 235
 *   - MAIL FROM → 250
 *   - RCPT TO → 250
 *   - DATA → 354 → \r\n.\r\n → 250
 *   - QUIT → 221
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@backend/persistence/database/database.ts";
import { SqliteProjectRepository } from "@backend/persistence/sqlite/sqlite-project.repository.ts";
import { ProjectService } from "@backend/application/project/project.service.ts";
import { SqliteProjectContactsRepository } from "@backend/persistence/sqlite/sqlite-project-contacts.repository.ts";
import { SqliteProjectTeamMembersRepository } from "@backend/persistence/sqlite/sqlite-project-team-members.repository.ts";
import { SqliteEmailRepository } from "@backend/persistence/sqlite/sqlite-email.repository.ts";
import { MailUseCase } from "@backend/application/mail/mail.usecase.ts";
import { FilesystemMailStorage } from "@backend/application/mail/mail.storage.ts";
import { SqliteSystemSettingRepository } from "@backend/persistence/sqlite/sqlite-system-setting.repository.ts";
import { createSmtpTransport } from "@backend/infrastructure/mail/smtp-transport.ts";
import { SqliteBackedSubAgentRegistry } from "@backend/persistence/sqlite/sqlite-sub-agent-registry.ts";
import { FixedClock } from "@backend/domain/shared/clock.ts";
import type { Logger } from "@backend/infrastructure/logging/logger.ts";
import type { MailAccount } from "@backend/domain/settings/mail-accounts.setting.ts";

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

interface FakeSmtpServer {
  port: number;
  host: string;
  /** 记录收到的 from/to/data，用于断言 */
  received: { from?: string; rcpts: string[]; data?: string; authUser?: string; authPass?: string };
  failNext: boolean;
  close(): void;
}

async function startFakeSmtp(): Promise<FakeSmtpServer> {
  const received: FakeSmtpServer["received"] = { rcpts: [] };
  const server: FakeSmtpServer = {
    port: 0,
    host: "127.0.0.1",
    received,
    failNext: false,
    close: () => {/* set below */},
  };
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  server.port = (listener.addr as Deno.NetAddr).port;
  server.host = (listener.addr as Deno.NetAddr).hostname;
  let active = true;
  server.close = () => {
    active = false;
    try { listener.close(); } catch { /* ignore */ }
  };

  (async () => {
    while (active) {
      let conn: Deno.TcpConn;
      try {
        conn = await listener.accept();
      } catch {
        return;
      }
      (async () => {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const buf = new Uint8Array(8192);
        let pending = "";
        let done = false;
        const log = (m: string) => {
          if (Deno.env.get("SMTP_DEBUG") === "1") console.error("[fake-smtp]", m);
        };
        try {
          await conn.write(encoder.encode("220 fake.smtp.local ESMTP Ready\r\n"));
          log("220 banner sent");
          while (!done) {
            const n = await conn.read(buf);
            if (n === null) break;
            pending += decoder.decode(buf.subarray(0, n));
            let idx: number;
            while ((idx = pending.indexOf("\r\n")) >= 0) {
              const line = pending.slice(0, idx);
              pending = pending.slice(idx + 2);

              log("RX: " + JSON.stringify(line));
              // 命令路由：按协议顺序匹配
              if (/^(EHLO|HELO)/i.test(line)) {
                await conn.write(encoder.encode("250-fake.smtp.local\r\n250 OK\r\n"));
              } else if (/^AUTH\s+LOGIN/i.test(line)) {
                await conn.write(encoder.encode("334 VXNlcm5hbWU6\r\n"));
              } else if (/^MAIL FROM:/i.test(line)) {
                received.from = line.replace(/^MAIL FROM:\s*/i, "").replace(/[<>]/g, "");
                await conn.write(encoder.encode("250 OK\r\n"));
              } else if (/^RCPT TO:/i.test(line)) {
                const to = line.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, "");
                received.rcpts.push(to);
                await conn.write(encoder.encode("250 OK\r\n"));
              } else if (/^DATA/i.test(line)) {
                await conn.write(encoder.encode("354 End data with <CR><LF>.<CR><LF>\r\n"));
                // 收集直到 .\r\n（可能跨多次 read）
                let dataBuf = "";
                while (true) {
                  if (dataBuf.endsWith("\r\n.\r\n")) break;
                  const m = await conn.read(buf);
                  if (m === null) break;
                  dataBuf += decoder.decode(buf.subarray(0, m));
                }
                // 切割剩余到 pending（处理 . 之后的数据）
                const endIdx = dataBuf.lastIndexOf("\r\n.\r\n");
                received.data = dataBuf.slice(0, endIdx);
                pending += dataBuf.slice(endIdx + 5);
                await conn.write(encoder.encode(
                  server.failNext ? "550 5.7.1 rejected\r\n" : "250 OK queued\r\n",
                ));
                if (server.failNext) {
                  done = true;
                  break;
                }
              } else if (/^QUIT/i.test(line)) {
                await conn.write(encoder.encode("221 Bye\r\n"));
                done = true;
                break;
              } else if (line.length > 0) {
                // AUTH LOGIN 后续：客户端发送 base64 username（line 非空且不匹配以上命令）
                // 此时 line 是 base64 字符串
                if (!received.authUser) {
                    received.authUser = atob(line);
                    await conn.write(encoder.encode("334 UGFzc3dvcmQ6\r\n"));
                  } else if (!received.authPass) {
                    received.authPass = atob(line);
                    await conn.write(encoder.encode("235 2.7.0 OK\r\n"));
                  } else {
                    // 后续 DATA 之后 client 可能发空行（payload 已经写过；这是 sendCommand 后置响应）
                    // 我们已通过 DATA 处理；这里 ignore
                  }
              }
              // 空行（client 在 DATA payload 之间）→ ignore
            }
          }
        } catch { /* ignore */ } finally {
          try { conn.close(); } catch { /* ignore */ }
        }
      })();
    }
  })();

  // 等 listener ready
  await new Promise((r) => setTimeout(r, 10));
  return server;
}

interface TestCtx {
  smtp: FakeSmtpServer;
  useCase: MailUseCase;
  tmpRoot: string;
  pid: string;
}

async function setupMailCtx(): Promise<TestCtx> {
  const tmpRoot = await Deno.makeTempDir({ prefix: "ai-mail-send-" });
  const db = new Database({
    paths: { root: tmpRoot, data: tmpRoot, logs: tmpRoot, vendor: tmpRoot, output: tmpRoot },
    inMemory: true,
    skipExtensions: true,
  });
  await db.ready();
  const clock = new FixedClock(new Date("2026-09-22T00:00:00Z"));
  const projRepo = new SqliteProjectRepository(db);
  const contactsRepo = new SqliteProjectContactsRepository(db);
  const teamRepo = new SqliteProjectTeamMembersRepository(db);
  const projectService = new ProjectService({ repo: projRepo, contactsRepo, teamRepo, clock });
  const r = await projectService.createProject({ name: "send-rt", clientName: "ACME" });
  assert(r.ok);
  if (!r.ok) throw new Error("project");
  const settingsRepo = new SqliteSystemSettingRepository(db);
  const smtp = await startFakeSmtp();
  const account: MailAccount = {
    id: "acc-default",
    displayName: "默认账号",
    host: smtp.host,
    port: smtp.port,
    username: "user",
    password: "pass",
    fromAddress: "user@example.com",
    ssl: "none",
    isDefault: true,
  };
  await settingsRepo.setMailAccounts({ accounts: [account] }, clock);
  const mailRepo = new SqliteEmailRepository(db);
  const storage = new FilesystemMailStorage(tmpRoot);
  const useCase = new MailUseCase({
    repo: mailRepo,
    storage,
    clock,
    logger: makeLogger(),
    settings: settingsRepo,
    smtpFactory: createSmtpTransport,
  });
  return {
    smtp,
    useCase,
    tmpRoot,
    pid: r.value.id,
  };
}

Deno.test("mail-send — 合法 send → status=sent + SMTP 收到 DATA", async () => {
  const ctx = await setupMailCtx();
  try {
    // 创建草稿
    const created = await ctx.useCase.createDraft({
      projectId: ctx.pid as never,
      subject: "Hello",
      body: "Body content",
      to: [{ name: "Bob", email: "bob@example.com" }],
      cc: [],
      createdAt: new FixedClock(new Date()).now(),
    });
    assert(created.ok);
    if (!created.ok) return;
    const r = await ctx.useCase.send(created.value.id);
    assert(r.ok);
    if (!r.ok) return;
    assertEquals(r.value.status, "sent");
    assertEquals(r.value.sentAt instanceof Date, true);
    // SMTP 收到了 from / to / data
    assertEquals(ctx.smtp.received.from, "user@example.com");
    assert(ctx.smtp.received.rcpts.includes("bob@example.com"));
    assert(ctx.smtp.received.data && ctx.smtp.received.data.length > 0);
    // body 是 base64 编码的；验证 base64 of "Body content" = "Qm9keSBjb250ZW50"
    assert(ctx.smtp.received.data && ctx.smtp.received.data.includes("Qm9keSBjb250ZW50"));
    assertEquals(ctx.smtp.received.authUser, "user");
    assertEquals(ctx.smtp.received.authPass, "pass");
  } finally {
    ctx.smtp.close();
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(ctx.tmpRoot, { recursive: true });
  }
});

Deno.test("mail-send — SMTP 拒连 → status=failed + errorMessage", async () => {
  const ctx = await setupMailCtx();
  try {
    // 让下一次 DATA 失败
    ctx.smtp.failNext = true;
    const created = await ctx.useCase.createDraft({
      projectId: ctx.pid as never,
      subject: "X",
      body: "B",
      to: [{ name: "B", email: "b@x.com" }],
      cc: [],
      createdAt: new Date(),
    });
    assert(created.ok);
    if (!created.ok) return;
    const r = await ctx.useCase.send(created.value.id);
    assert(!r.ok);
    assertEquals(r.error.code, "INTERNAL");
    // 检查邮件已切到 failed
    const got = await ctx.useCase.get(created.value.id);
    assert(got.ok);
    if (got.ok) {
      assertEquals(got.value.status, "failed");
      assert(got.value.failedAt instanceof Date);
      assert(got.value.errorMessage && got.value.errorMessage.includes("rejected"));
    }
  } finally {
    ctx.smtp.close();
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(ctx.tmpRoot, { recursive: true });
  }
});

Deno.test("mail-send — mail account 缺失 → INVALID_INPUT", async () => {
  const ctx = await setupMailCtx();
  try {
    // 移除账号
    await ctx.useCase; // noop
    const tmpRoot2 = await Deno.makeTempDir({ prefix: "ai-mail-noacc-" });
    try {
      const db = new Database({
        paths: { root: tmpRoot2, data: tmpRoot2, logs: tmpRoot2, vendor: tmpRoot2, output: tmpRoot2 },
        inMemory: true,
        skipExtensions: true,
      });
      await db.ready();
      const clock = new FixedClock(new Date());
      const projRepo = new SqliteProjectRepository(db);
      const contactsRepo = new SqliteProjectContactsRepository(db);
      const teamRepo = new SqliteProjectTeamMembersRepository(db);
      const ps = new ProjectService({ repo: projRepo, contactsRepo, teamRepo, clock });
      const pr = await ps.createProject({ name: "p", clientName: "c" });
      assert(pr.ok);
      if (!pr.ok) return;
      const settingsRepo = new SqliteSystemSettingRepository(db);
      // 不设账号
      const mailRepo = new SqliteEmailRepository(db);
      const storage = new FilesystemMailStorage(tmpRoot2);
      const useCase = new MailUseCase({
        repo: mailRepo,
        storage,
        clock,
        logger: makeLogger(),
        settings: settingsRepo,
        smtpFactory: createSmtpTransport,
      });
      const created = await useCase.createDraft({
        projectId: pr.value.id,
        subject: "X",
        body: "B",
        to: [{ name: "B", email: "b@x.com" }],
        cc: [],
        createdAt: clock.now(),
      });
      assert(created.ok);
      if (!created.ok) return;
      const r = await useCase.send(created.value.id);
      assert(!r.ok);
      assertEquals(r.error.code, "INVALID_INPUT");
    } finally {
      await Deno.remove(tmpRoot2, { recursive: true });
    }
  } finally {
    ctx.smtp.close();
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(ctx.tmpRoot, { recursive: true });
  }
});

Deno.test("mail-send — multi-account 显式 accountId → 用指定账号", async () => {
  const ctx = await setupMailCtx();
  try {
    // 多加一个账号
    const accounts = [
      {
        id: "acc-default",
        displayName: "默认",
        host: ctx.smtp.host,
        port: ctx.smtp.port,
        username: "user-default",
        password: "pass-default",
        fromAddress: "default@example.com",
        ssl: "none" as const,
        isDefault: true,
      },
      {
        id: "acc-other",
        displayName: "其他",
        host: ctx.smtp.host,
        port: ctx.smtp.port,
        username: "user-other",
        password: "pass-other",
        fromAddress: "other@example.com",
        ssl: "none" as const,
        isDefault: false,
      },
    ];
    // 通过 settingsRepo 直接 set
    const tmpRoot = ctx.tmpRoot;
    const db = new Database({
      paths: { root: tmpRoot, data: tmpRoot, logs: tmpRoot, vendor: tmpRoot, output: tmpRoot },
      inMemory: true,
      skipExtensions: true,
    });
    await db.ready();
    const clock = new FixedClock(new Date());
    const settingsRepo = new SqliteSystemSettingRepository(db);
    await settingsRepo.setMailAccounts({ accounts }, clock);
    const mailRepo = new SqliteEmailRepository(db);
    const storage = new FilesystemMailStorage(tmpRoot);
    const useCase = new MailUseCase({
      repo: mailRepo,
      storage,
      clock,
      logger: makeLogger(),
      settings: settingsRepo,
      smtpFactory: createSmtpTransport,
    });
    const projRepo = new SqliteProjectRepository(db);
    const contactsRepo = new SqliteProjectContactsRepository(db);
    const teamRepo = new SqliteProjectTeamMembersRepository(db);
    const ps = new ProjectService({ repo: projRepo, contactsRepo, teamRepo, clock });
    const pr = await ps.createProject({ name: "p2", clientName: "c" });
    assert(pr.ok);
    if (!pr.ok) return;
    const created = await useCase.createDraft({
      projectId: pr.value.id,
      subject: "X",
      body: "B",
      to: [{ name: "B", email: "b@x.com" }],
      cc: [],
      createdAt: clock.now(),
    });
    assert(created.ok);
    if (!created.ok) return;
    const r = await useCase.send(created.value.id, "acc-other");
    assert(r.ok);
    assertEquals(r.value.status, "sent");
    assertEquals(ctx.smtp.received.authUser, "user-other");
    assertEquals(ctx.smtp.received.from, "other@example.com");
  } finally {
    ctx.smtp.close();
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(ctx.tmpRoot, { recursive: true });
  }
});

Deno.test("mail-send — multi-account 不传 accountId → 用 isDefault", async () => {
  const ctx = await setupMailCtx();
  try {
    const accounts = [
      {
        id: "acc-default",
        displayName: "默认",
        host: ctx.smtp.host,
        port: ctx.smtp.port,
        username: "user-default",
        password: "pass-default",
        fromAddress: "default@example.com",
        ssl: "none" as const,
        isDefault: true,
      },
      {
        id: "acc-other",
        displayName: "其他",
        host: ctx.smtp.host,
        port: ctx.smtp.port,
        username: "user-other",
        password: "pass-other",
        fromAddress: "other@example.com",
        ssl: "none" as const,
        isDefault: false,
      },
    ];
    const tmpRoot = ctx.tmpRoot;
    const db = new Database({
      paths: { root: tmpRoot, data: tmpRoot, logs: tmpRoot, vendor: tmpRoot, output: tmpRoot },
      inMemory: true,
      skipExtensions: true,
    });
    await db.ready();
    const clock = new FixedClock(new Date());
    const settingsRepo = new SqliteSystemSettingRepository(db);
    await settingsRepo.setMailAccounts({ accounts }, clock);
    const mailRepo = new SqliteEmailRepository(db);
    const storage = new FilesystemMailStorage(tmpRoot);
    const useCase = new MailUseCase({
      repo: mailRepo,
      storage,
      clock,
      logger: makeLogger(),
      settings: settingsRepo,
      smtpFactory: createSmtpTransport,
    });
    const projRepo = new SqliteProjectRepository(db);
    const contactsRepo = new SqliteProjectContactsRepository(db);
    const teamRepo = new SqliteProjectTeamMembersRepository(db);
    const ps = new ProjectService({ repo: projRepo, contactsRepo, teamRepo, clock });
    const pr = await ps.createProject({ name: "p3", clientName: "c" });
    assert(pr.ok);
    if (!pr.ok) return;
    const created = await useCase.createDraft({
      projectId: pr.value.id,
      subject: "X",
      body: "B",
      to: [{ name: "B", email: "b@x.com" }],
      cc: [],
      createdAt: clock.now(),
    });
    assert(created.ok);
    if (!created.ok) return;
    const r = await useCase.send(created.value.id); // 不传 accountId
    assert(r.ok);
    assertEquals(ctx.smtp.received.authUser, "user-default");
    assertEquals(ctx.smtp.received.from, "default@example.com");
  } finally {
    ctx.smtp.close();
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(ctx.tmpRoot, { recursive: true });
  }
});

Deno.test("mail-send — 附件 send 成功", async () => {
  const ctx = await setupMailCtx();
  try {
    const created = await ctx.useCase.createDraft({
      projectId: ctx.pid as never,
      subject: "With attachment",
      body: "see attached",
      to: [{ name: "B", email: "b@x.com" }],
      cc: [],
      createdAt: new Date(),
    });
    assert(created.ok);
    if (!created.ok) return;
    // 加附件
    const attRes = await ctx.useCase.addAttachment({
      emailId: created.value.id,
      filename: "test.txt",
      mime: "text/plain",
      bytes: new TextEncoder().encode("hello attachment"),
    });
    assert(attRes.ok);
    const r = await ctx.useCase.send(created.value.id);
    assert(r.ok);
    if (!r.ok) return;
    assertEquals(r.value.status, "sent");
    assert(ctx.smtp.received.data && ctx.smtp.received.data.includes("test.txt"));
    // MIME multipart 应包含 boundary
    assertStringIncludes(ctx.smtp.received.data, "multipart");
  } finally {
    ctx.smtp.close();
    SqliteBackedSubAgentRegistry.clearCacheForTests();
    await Deno.remove(ctx.tmpRoot, { recursive: true });
  }
});