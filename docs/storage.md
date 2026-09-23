# 存储

## SQLite 客户端

使用 **`node:sqlite`**（Deno v2.2+ 内置，官方推荐）：

```ts
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("path/to/app.db");
db.exec("CREATE TABLE ...");
db.prepare("INSERT ...").run(...);
db.prepare("SELECT ...").all(...);
```

不要用 `jsr:@db/sqlite` —— Deno 已将 SQLite 内置到 node 兼容层，没必要再用第三方封装。

## 三库分工

| 库 | 用于 | 不存 |
|---|---|---|
| **SQLite 主库** | 业务实体（projects、ai_sessions、messages、tool_calls、knowledge_items 元数据） | 向量 |
| **SQLite-Vector 扩展** | 已采纳知识的 embedding 索引（按 projectId 分片）；向量作为 BLOB 存在普通表里 | — |
| ~~SQLite-Memory~~ | 本期用主库 messages 表 + `expire_at` TTL 字段代替；后续可换 | — |

## sqlite-vector 用法（重要：当前 API 与早期版本不同）

**不要**用旧的 `vec0` 虚拟表。当前 sqlite-vector 用**普通表 + BLOB**：

```sql
-- 1. 创建普通表
CREATE TABLE knowledge_items (
  id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT,
  embedding BLOB,            -- Float32[N] 字节向量
  adopted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 2. 初始化向量列
SELECT vector_init('knowledge_items', 'embedding',
                 'type=FLOAT32,dimension=1536,distance=COSINE');

-- 3. KNN 查询（返回 top-k 最近邻）
SELECT e.id, e.content, v.distance
FROM knowledge_items AS e
JOIN vector_quantize_scan('knowledge_items', 'embedding', ?, 5) AS v
  ON e.id = v.rowid
ORDER BY v.distance ASC;
```

支持的距离：`L1`, `COSINE`, `DOT`, `SQUARED_L2`, `HAMMING`。可选 `normalized=1` 跳过归一化（如果你的 embedding 已经是单位向量）。

可选 TurboQuant 量化（4x-5x 加速，损失小）：

```sql
SELECT vector_quantize('knowledge_items', 'embedding', 'qtype=TURBO,qbits=4');
SELECT vector_quantize_preload('knowledge_items', 'embedding');
```

## 路径

```
APP_DATA_DIR/
├── data/
│   └── app.db              # SQLite 主库（含 messages TTL）
├── logs/
│   └── app.log
├── vendor/
│   └── vector.{dylib,so,dll}  # SQLite-Vector 扩展
└── output/                  # AI 输出文件默认目录
```

APP_DATA_DIR 默认值：
- macOS：`~/Library/Application Support/ai-presales`
- Windows：`%APPDATA%/ai-presales`
- Linux：`~/.local/share/ai-presales`

可通过 `APP_DATA_DIR` 环境变量覆盖。

## 扩展加载

按平台分支：

| 平台 | 扩展文件 |
|---|---|
| darwin/arm64 | vector.dylib |
| darwin/x64 | vector.dylib |
| linux/x64 | vector.so |
| win/x64 | vector.dll |

**加载方式**：`db.loadExtension(path)`。`node:sqlite` 直接提供 `loadExtension` 方法。

**缺失处理**：抛 `MissingExtensionError`，前端给清晰指引，**不静默降级**。

拉取脚本：`deno task fetch:extensions`（阶段 2 接入实际下载逻辑）。

## 迁移

- 单向迁移，文件命名 `NNN_xxx.sql`
- `MigrationRunner` 启动时检查 `schema_migrations` 表，应用未执行的迁移
- 每一迁移在事务内执行

## 事务

- 聚合根保存 = 一个事务
- 跨聚合由 `UnitOfWork` 串起
- 领域事件在事务提交后再由 `DomainEventDispatcher` 投递

## Deno 权限

```bash
deno run -A main.ts
# -A 等价 --allow-all
```

`deno compile` 出来的二进制默认开启 FFI，无需 --allow-ffi。