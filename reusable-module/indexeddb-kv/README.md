# indexeddb-kv

通用 IndexedDB KV 封装（零依赖，TypeScript）。提供单例连接、request/transaction 包装、按主键增删改查、全表读取、清空、按索引范围查询。

## 为什么沉淀

家庭财务管家（pipeline 014）首次实现 IndexedDB 数据层时，openDB/request/transaction/getAll/put/remove/clear 是高度通用的样板代码；沉淀为通用封装后，后续任何本地存储类工具可直接引用，避免重复造轮子。

## API

- `openIndexedDB(cfg)`：打开/复用连接，按 spec 建表建索引
- `putValue / getValue / getAllValues / removeValue / clearValues`：主键 CRUD
- `listByIndex(storeName, indexName, start?, end?)`：按索引范围查询（含边界）

配置示例：

```ts
const cfg: IndexedDBConfig = {
  dbName: 'my-app',
  version: 1,
  stores: [
    { storeName: 'items', keyPath: 'id', indexes: [['date', 'date']] }
  ]
}
await putValue(cfg, 'items', { id: 'a', date: '2026-10-14' })
const all = await getAllValues(cfg, 'items')
const today = await listByIndex(cfg, 'items', 'date', '2026-10-14', '2026-10-14')
```

## 参考实现

方子 `src/tools/household-finance/store.ts`（ledgers/categories/budgets 三表 + AES-GCM/PBKDF2 加密备份）。
