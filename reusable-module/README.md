# reusable-module 通用模块库

跨工具复用的通用功能模块。使用前先查看本 README 与各模块说明，**优先复用、不要重复造轮子**。

## 模块清单

| 模块 | 简介 | 位置 | 状态 |
|---|---|---|---|
| indexeddb-kv | 通用 IndexedDB KV 封装：单例连接、增删改查、清空、按索引范围查询（零依赖 TS） | `indexeddb-kv/indexeddb-kv.ts` | 2026-10-14 由家庭财务管家（pipeline 014）沉淀 |

## 新增模块规范

1. 每个模块一个独立子目录，模块名 kebab-case。
2. 模块目录下放实现文件 + 简短 `README.md`（简介、API、使用示例）。
3. 完成后更新本 README 的模块清单（简介、位置、日期）。
