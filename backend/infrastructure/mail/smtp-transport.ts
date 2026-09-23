/**
 * SMTP Transport —— 阶段 7.4h
 *
 * 最小手写 SMTP 客户端（基于 Deno.connect / Deno.startTls），避免引入 denomailer 的 transitive deps。
 *
 * 支持：
 *   - 普通 SMTP（连接即 SMTP 协议）
 *   - SMTPS（ssl=tls：连接后立即 TLS 握手）
 *   - STARTTLS（ssl=starttls：连接 → EHLO → STARTTLS → TLS 握手）
 *   - AUTH LOGIN（base64(username) / base64(password)）
 *   - MAIL FROM / RCPT TO / DATA + 最小 MIME 拼装
 *   - 附件（multipart/mixed）
 */

import type { MailAccount } from "@backend/domain/settings/mail-accounts.setting.ts";

export interface Address {
  readonly name: string;
  readonly email: string;
}

export interface SmtpAttachment {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export interface SmtpSendArgs {
  readonly from: string;
  readonly to: readonly Address[];
  readonly cc: readonly Address[];
  readonly subject: string;
  readonly body: string;
  readonly attachments?: readonly SmtpAttachment[];
}

export interface SmtpSendResult {
  readonly messageId: string;
}

export interface SmtpTransport {
  send(args: SmtpSendArgs): Promise<SmtpSendResult>;
}

export class SmtpTransportError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "SmtpTransportError";
  }
}

export function createSmtpTransport(account: MailAccount): SmtpTransport {
  return {
    async send(args) {
      return await smtpSend(account, args);
    },
  };
}

// ---------- 内部实现 ----------

interface TcpHolder {
  raw: Deno.Conn;
  buf: Uint8Array;
  pending: string;
}

function makeHolder(raw: Deno.Conn): TcpHolder {
  return { raw, buf: new Uint8Array(8192), pending: "" };
}

async function smtpSend(account: MailAccount, args: SmtpSendArgs): Promise<SmtpSendResult> {
  const holder = await openConnection(account);

  try {
    await readReply(holder);

    await writeAll(holder, new TextEncoder().encode(`EHLO ${extractDomain(args.from) || "localhost"}\r\n`));
    const ehloResp = await readMultilineReply(holder);
    expectCode(ehloResp, 250);

    if (account.ssl === "starttls") {
      const startTlsResp = await sendCommand(holder, "STARTTLS");
      expectCode(startTlsResp, 220);
      holder.raw.close();
      const newRaw = await Deno.connect({ hostname: account.host, port: account.port, transport: "tcp" });
      holder.raw = await Deno.startTls(newRaw, { hostname: account.host });
      holder.pending = "";
      await writeAll(holder, new TextEncoder().encode(`EHLO ${extractDomain(args.from) || "localhost"}\r\n`));
      const ehlo2Resp = await readMultilineReply(holder);
      expectCode(ehlo2Resp, 250);
    }

    const authResp = await sendCommand(holder, "AUTH LOGIN");
    expectCode(authResp, 334);
    const userResp = await sendCommand(holder, btoa(account.username));
    expectCode(userResp, 334);
    const passResp = await sendCommand(holder, btoa(account.password));
    expectCode(passResp, 235);

    const mailResp = await sendCommand(holder, `MAIL FROM:<${extractBareAddress(args.from)}>`);
    expectCode(mailResp, 250);

    for (const a of args.to) {
      const r = await sendCommand(holder, `RCPT TO:<${a.email}>`);
      expectCode(r, 250);
    }
    for (const a of args.cc) {
      const r = await sendCommand(holder, `RCPT TO:<${a.email}>`);
      expectCode(r, 250);
    }

    const dataResp = await sendCommand(holder, "DATA");
    expectCode(dataResp, 354);

    const messageId = `<${crypto.randomUUID()}@${extractDomain(args.from) || "ai-presales.local"}>`;
    const payload = buildMime({
      from: args.from,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      body: args.body,
      attachments: args.attachments ?? [],
      messageId,
    });
    await writeAll(holder, payload);
    await writeAll(holder, new TextEncoder().encode("\r\n.\r\n"));

    const doneResp = await readReply(holder);
    expectCode(doneResp, 250);

    try {
      const quitResp = await sendCommand(holder, "QUIT");
      expectCode(quitResp, 221);
    } catch {
      // 关闭时的错误可忽略
    }

    return { messageId };
  } finally {
    try { holder.raw.close(); } catch { /* ignore */ }
  }
}

async function openConnection(account: MailAccount): Promise<TcpHolder> {
  if (account.ssl === "tls") {
    const raw = await Deno.connect({ hostname: account.host, port: account.port, transport: "tcp" });
    const upgraded = await Deno.startTls(raw, { hostname: account.host });
    return makeHolder(upgraded);
  }
  const raw = await Deno.connect({ hostname: account.host, port: account.port, transport: "tcp" });
  return makeHolder(raw);
}

async function sendCommand(holder: TcpHolder, line: string): Promise<string> {
  await writeAll(holder, new TextEncoder().encode(line + "\r\n"));
  return await readReply(holder);
}

async function readReply(holder: TcpHolder): Promise<string> {
  while (!holder.pending.includes("\r\n")) {
    const n = await holder.raw.read(holder.buf);
    if (n === null) throw new SmtpTransportError("connection closed unexpectedly", "CONNECTION_CLOSED");
    holder.pending += new TextDecoder().decode(holder.buf.subarray(0, n));
  }
  const idx = holder.pending.indexOf("\r\n");
  const line = holder.pending.slice(0, idx);
  holder.pending = holder.pending.slice(idx + 2);
  return line;
}

/** 读 EHLO 的多行回复（最后一行的第 4 字符是空格，不是 '-'）。 */
async function readMultilineReply(holder: TcpHolder): Promise<string> {
  let last = "";
  while (true) {
    const line = await readReply(holder);
    last = line;
    // 第 4 字符（index 3）是 ' ' 表示这是最后一行的 continuation
    if (line.length < 4 || line[3] === " ") break;
  }
  return last;
}

function expectCode(reply: string, expected: number): void {
  // SMTP reply 可能多行（如 250-... 250-... 250 OK）；调用方每次拿一行；这里假定 reply 是单行
  const code = parseInt(reply.slice(0, 3), 10);
  if (code !== expected) {
    throw new SmtpTransportError(`unexpected SMTP reply: ${reply}`, "BAD_REPLY");
  }
}

async function writeAll(holder: TcpHolder, bytes: Uint8Array): Promise<void> {
  let n = await holder.raw.write(bytes);
  while (n < bytes.byteLength) {
    n += await holder.raw.write(bytes.subarray(n));
  }
}

function extractBareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  if (m) return m[1];
  return from.trim();
}

function extractDomain(addr: string): string {
  const bare = extractBareAddress(addr);
  const idx = bare.indexOf("@");
  return idx >= 0 ? bare.slice(idx + 1) : "";
}

// ---------- MIME 拼装 ----------

interface MimeArgs {
  from: string;
  to: readonly Address[];
  cc: readonly Address[];
  subject: string;
  body: string;
  attachments: readonly SmtpAttachment[];
  messageId: string;
}

function buildMime(args: MimeArgs): Uint8Array {
  const boundary = `mixed-${crypto.randomUUID().replace(/-/g, "")}`;
  const enc = new TextEncoder();
  const lines: Uint8Array[] = [];

  lines.push(enc.encode(`Message-ID: ${args.messageId}\r\n`));
  lines.push(enc.encode(`Date: ${new Date().toUTCString()}\r\n`));
  lines.push(enc.encode(`From: ${args.from}\r\n`));
  lines.push(enc.encode(`To: ${args.to.map(formatAddr).join(", ")}\r\n`));
  if (args.cc.length > 0) {
    lines.push(enc.encode(`Cc: ${args.cc.map(formatAddr).join(", ")}\r\n`));
  }
  lines.push(enc.encode(`Subject: ${encodeHeader(args.subject)}\r\n`));
  lines.push(enc.encode(`MIME-Version: 1.0\r\n`));

  if (args.attachments.length === 0) {
    lines.push(enc.encode(`Content-Type: text/plain; charset=utf-8\r\n`));
    lines.push(enc.encode(`Content-Transfer-Encoding: base64\r\n`));
    lines.push(enc.encode(`\r\n`));
    lines.push(enc.encode(encodeBase64(args.body)));
  } else {
    lines.push(enc.encode(`Content-Type: multipart/mixed; boundary="${boundary}"\r\n`));
    lines.push(enc.encode(`\r\n`));
    lines.push(enc.encode(`--${boundary}\r\n`));
    lines.push(enc.encode(`Content-Type: text/plain; charset=utf-8\r\n`));
    lines.push(enc.encode(`Content-Transfer-Encoding: base64\r\n`));
    lines.push(enc.encode(`\r\n`));
    lines.push(enc.encode(encodeBase64(args.body)));
    lines.push(enc.encode(`\r\n`));
    for (const att of args.attachments) {
      lines.push(enc.encode(`--${boundary}\r\n`));
      lines.push(enc.encode(`Content-Type: ${att.mime}; name="${att.filename}"\r\n`));
      lines.push(enc.encode(`Content-Transfer-Encoding: base64\r\n`));
      lines.push(enc.encode(`Content-Disposition: attachment; filename="${att.filename}"\r\n`));
      lines.push(enc.encode(`\r\n`));
      lines.push(enc.encode(encodeBase64Bytes(att.bytes)));
      lines.push(enc.encode(`\r\n`));
    }
    lines.push(enc.encode(`--${boundary}--\r\n`));
  }

  const totalLen = lines.reduce((acc, b) => acc + b.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of lines) {
    out.set(b, offset);
    offset += b.byteLength;
  }
  return out;
}

function formatAddr(a: Address): string {
  return a.name ? `"${a.name}" <${a.email}>` : a.email;
}

function encodeHeader(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?utf-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

function encodeBase64(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}