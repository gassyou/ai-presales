/**
 * Clock 实现 —— 系统时钟 + 测试假时钟
 *
 * 测试用：
 *   const fixed = new FixedClock(new Date("2026-01-01T00:00:00Z"));
 *   p.rename("新名字", fixed);     // 不依赖 wall clock
 */

import type { Clock } from "./domain-event.ts";

export type { Clock } from "./domain-event.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  private at: Date;
  constructor(initial: Date) {
    this.at = new Date(initial.getTime());
  }
  now(): Date {
    return new Date(this.at.getTime());
  }
  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms);
  }
  set(date: Date): void {
    this.at = new Date(date.getTime());
  }
}