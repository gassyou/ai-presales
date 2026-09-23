/**
 * DomainEvent —— 领域事件基类
 *
 * 事件用于：
 *   1. 同一进程内跨层通知（仓储提交后触发副作用）
 *   2. 未来跨进程 / 跨服务（事件总线、消息队列）
 *
 * 设计：
 *   - 不可变 record
 *   - aggregateId 必有 —— 来源聚合根
 *   - occurredAt 在 create 时确定（避免人为干预）
 *   - 子类用 static create() 工厂，保持与聚合根一致的构造规范
 */

export abstract class DomainEvent {
  abstract readonly eventName: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;

  protected constructor(aggregateId: string, occurredAt: Date) {
    this.aggregateId = aggregateId;
    this.occurredAt = occurredAt;
  }

  /** 序列化为可落库 / 可上送的事件 —— 子类可覆盖以携带 payload */
  toJSON(): Record<string, unknown> {
    return {
      eventName: this.eventName,
      aggregateId: this.aggregateId,
      occurredAt: this.occurredAt.toISOString(),
    };
  }
}

/** Clock 抽象 —— 用接口便于在测试中替换（生产用 system clock） */
export interface Clock {
  now(): Date;
}