/**
 * 总体《用户使用手册》内容。
 * 单一事实来源为仓库根 `docs/用户使用手册.md`：构建期通过 ?raw 直接打包该文件，
 * 页面与仓库文档始终同源，无需在 src 内再维护一份副本。
 */
const modules = import.meta.glob<string>('../../docs/用户使用手册.md', {
  query: '?raw',
  import: 'default',
  eager: true
})

export const USER_MANUAL: string =
  Object.values(modules)[0] ?? '# 方子 · 使用手册\n\n暂未读取到手册内容，请查看仓库 docs/用户使用手册.md。'
