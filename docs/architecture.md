# 架构

## 分层与依赖方向

```
presentation → application → domain ← infrastructure
```

- **presentation**（`backend/presentation/`）：HTTP 路由、handler、参数校验、响应映射、SSE 写入
- **application**（`backend/application/`）：用例编排、跨聚合事务、DTO 组装
- **domain**（`backend/domain/`）：业务规则、聚合、值对象、领域事件、仓储**接口**
- **infrastructure**（`backend/infrastructure/` + `backend/persistence/` + `backend/ai/`）：配置、日志、平台、DB、LLM SDK 实现

## 依赖禁止

| 层 | 禁止 |
|---|---|
| domain | import 任何 io/fs/http/db/sdk；任何 IO 调用 |
| application | 直接操作 DB、调用 provider SDK |
| presentation | 定义业务规则 |
| infrastructure | 被 domain 反向依赖（除非实现 domain 端口） |

## 领域对象规范

```ts
// 正确：class + private + private constructor + 工厂
class Project extends AggregateRoot<ProjectId> {
  private constructor(
    private readonly id: ProjectId,
    private name: ProjectName,
    private status: ProjectStatus,
    private readonly createdAt: Date,
  ) { super(id); }

  static create(name: ProjectName): Project { /* 校验 + 事件 */ }
  rename(newName: ProjectName): void { /* 状态机 + 事件 */ }
}
```

禁止：裸 interface 当 entity、public setter、构造函数暴露。

## 仓储接口位置

domain 定义 `IProjectRepository`，infrastructure 提供 `SqliteProjectRepository`。application 层通过构造函数注入。

## 事务边界

聚合根保存 = 一个事务。`Repository.save(aggregate)` 内部 BEGIN/COMMIT。跨聚合用 `UnitOfWork` 串起。

## 测试策略

- 单元测试镜像 `backend/` 目录结构
- 集成测试覆盖：API → SQLite → LLM（用 fake LLM server）
- 所有 LLM 适配器必须通过 `tests/unit/ai/llm-client.contract.test.ts`
