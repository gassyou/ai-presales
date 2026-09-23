/**
 * AggregateRoot 基类
 *
 * 聚合根是事务边界与一致性边界：
 *   - save() 由仓储负责，整个聚合一个事务
 *   - 领域事件收集 + 提交后 dispatch
 *
 * 子类规范：
 *   1. class extends AggregateRoot<IdType>
 *   2. private constructor + private readonly 字段
 *   3. static create(...) 工厂：new + this.addDomainEvent(...)
 *   4. 状态变更走公开方法（rename/archive/...），内部 addDomainEvent
 *   5. 不暴露 setter
 */

import type { DomainEvent } from "./domain-event.ts";

export abstract class AggregateRoot<TId> {
  private readonly _id: TId;
  private readonly _events: DomainEvent[] = [];

  protected constructor(id: TId) {
    this._id = id;
  }

  /** 聚合根 ID；只读 */
  get id(): TId {
    return this._id;
  }

  /** 已发生但尚未 dispatch 的事件快照（只读） */
  get pendingEvents(): readonly DomainEvent[] {
    return this._events;
  }

  /** 子类在状态变更时调用 */
  protected addDomainEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  /** 仓储 / UnitOfWork 在 commit 后调用 —— 把事件交出去并清空 */
  pullDomainEvents(): DomainEvent[] {
    const events = [...this._events];
    this._events.length = 0;
    return events;
  }
}