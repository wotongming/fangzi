/** 代码生成公共工具：标识符转换与字符串安全。 */
import { slug, type PropType } from './model'

/** kebab/任意 -> PascalCase（press -> Press；my-event -> MyEvent） */
export function pascal(s: string): string {
  return slug(s)
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('') || 'Event'
}

/** kebab -> camelCase（my-prop -> myProp） */
export function camel(s: string): string {
  const p = pascal(s)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

/**
 * 生成一个安全的 JS 字符串字面量。
 * 关键：把 `<` 转成 unicode 转义，防止用户文本里的 `</script>` 在被内联进
 * HTML <script>（iframe srcdoc / 独立演示页）时提前闭合脚本。
 * 解析回来仍是原字符，不影响运行时值。
 */
export function jsStr(s: unknown): string {
  return JSON.stringify(s == null ? '' : String(s)).replace(/</g, '\\u003c')
}

/** 按属性类型把 attribute 字符串值转换为 JS 值 */
export function coerceFromAttr(type: PropType, raw: string | null, fallback: string): unknown {
  if (type === 'boolean') return raw != null
  if (type === 'number') {
    const n = Number(raw == null ? fallback : raw)
    return Number.isFinite(n) ? n : 0
  }
  return raw == null ? fallback : raw
}

/** 默认值字面量（用于生成源码中的初始值） */
export function defaultLiteral(type: PropType, raw: string): string {
  if (type === 'boolean') return String(raw).trim().toLowerCase() === 'true' ? 'true' : 'false'
  if (type === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? String(n) : '0'
  }
  return jsStr(raw)
}

/** 合法 JS 标识符：仅保留字母/数字/_/$，数字开头则补下划线；空则回退 */
export function safeIdent(s: unknown, fallback = 'prop'): string {
  let x = String(s ?? '').replace(/[^A-Za-z0-9_$]/g, '')
  if (!x) x = fallback
  if (/^[0-9]/.test(x)) x = '_' + x
  return x
}

/**
 * 合法 PascalCase 类/方法名标识符。
 * className 入库时已是 PascalCase（如 MyButton），这里只做“去非法字符 + 首字母大写”，
 * 保留其内部大小写，避免再走一遍 pascal() 把 MyButton 压成 Mybutton。
 */
export function safePascalIdent(s: unknown, fallback = 'Component'): string {
  let x = String(s ?? '').replace(/[^A-Za-z0-9_$]/g, '')
  if (!x) x = fallback
  if (/^[0-9]/.test(x)) x = 'C' + x
  return x.charAt(0).toUpperCase() + x.slice(1)
}

/** 用于生成源码注释：去掉注释闭合符与尖括号，防止 </script> 提前闭合内联脚本 */
export function safeComment(s: unknown): string {
  return String(s ?? '').replace(/\*\//g, '* /').replace(/[<>]/g, '')
}

/** CSS 变量名 / 事件名 / 插槽名等 kebab 片段（仅 [a-z0-9-]） */
export function safeKebab(s: unknown): string {
  return slug(String(s ?? '')).replace(/^-+|-+$/g, '')
}
