/**
 * 结构化日志 —— 简洁实现，无外部依赖
 *
 * 设计要点：
 *  - 每个日志条目带 traceId，便于跨服务/跨模块关联
 *  - 级别: debug < info < warn < error
 *  - 可选输出到文件（追加模式，不做 rotate；rotate 由外层脚本做）
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  readonly level: LogLevel;
  child(fields: LogFields): Logger;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

interface LoggerOptions {
  level: LogLevel;
  context?: LogFields;
  sink?: (line: string) => void;
}

function defaultSink(line: string): void {
  // 简单 stdout 写出；后续阶段可加文件 sink
  console.log(line);
}

function format(level: LogLevel, msg: string, context: LogFields): string {
  const ts = new Date().toISOString();
  const ctx = Object.keys(context).length > 0 ? " " + JSON.stringify(context) : "";
  return `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${ctx}`;
}

class DefaultLogger implements Logger {
  readonly level: LogLevel;
  private readonly context: LogFields;
  private readonly sink: (line: string) => void;

  constructor(opts: LoggerOptions) {
    this.level = opts.level;
    this.context = opts.context ?? {};
    this.sink = opts.sink ?? defaultSink;
  }

  child(fields: LogFields): Logger {
    return new DefaultLogger({
      level: this.level,
      context: { ...this.context, ...fields },
      sink: this.sink,
    });
  }

  private log(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const merged = { ...this.context, ...(fields ?? {}) };
    this.sink(format(level, msg, merged));
  }

  debug(msg: string, fields?: LogFields): void { this.log("debug", msg, fields); }
  info(msg: string, fields?: LogFields): void { this.log("info", msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.log("warn", msg, fields); }
  error(msg: string, fields?: LogFields): void { this.log("error", msg, fields); }
}

let rootLogger: Logger | null = null;

export function setRootLogger(logger: Logger): void {
  rootLogger = logger;
}

export function getLogger(): Logger {
  if (rootLogger) return rootLogger;
  const envLevel = (Deno.env.get("LOG_LEVEL") ?? "info").toLowerCase() as LogLevel;
  const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
  const level: LogLevel = validLevels.includes(envLevel) ? envLevel : "info";
  rootLogger = new DefaultLogger({ level });
  return rootLogger;
}

export function createLogger(opts: { level?: LogLevel; context?: LogFields; sink?: (line: string) => void }): Logger {
  const base = getLogger();
  return new DefaultLogger({
    level: opts.level ?? base.level,
    context: opts.context,
    sink: opts.sink,
  });
}