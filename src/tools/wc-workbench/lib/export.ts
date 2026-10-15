/**
 * 打包导出（fflate，MIT）：
 *  - 单文件原生组件 .js（免费，<script> 即用）
 *  - 标准 npm 包结构 zip（Pro）：package.json + src + dist + custom-elements.json + 文档 + 演示
 *  - 组件模型 .json（可再次导入工作台继续编辑）
 */
import { zipSync, strToU8 } from 'fflate'
import type { ComponentModel } from './model'
import { tagNameOf } from './model'
import { nativeSource, nativeFileName } from './generate/native'
import { litSource, litFileName } from './generate/lit'
import { reactSource, reactFileName, vueSource, vueFileName } from './generate/wrappers'
import { manifestJson } from './manifest-gen'
import { docsMarkdown, demoHtml } from './docs'

export interface FileEntry {
  path: string
  content: string
}

export function downloadBlob(data: Uint8Array | BlobPart, filename: string, mime: string): void {
  const blob = data instanceof Uint8Array ? new Blob([data as BlobPart], { type: mime }) : new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(content: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  // 直接以字符串构造 Blob（与 embed-widget-builder 验证过的下载路径一致），
  // 包 Uint8Array 在部分无头 Chromium 下会丢失 download 文件名。
  downloadBlob(content, filename, mime.includes('charset') ? mime : mime + ';charset=utf-8')
}

function packageJson(m: ComponentModel): string {
  const tag = tagNameOf(m)
  return JSON.stringify(
    {
      name: tag,
      version: '1.0.0',
      description: m.description,
      main: `dist/${tag}.js`,
      module: `dist/${tag}.js`,
      types: `dist/${tag}.d.ts`,
      type: 'module',
      customElements: 'custom-elements.json',
      keywords: ['web-components', 'custom-elements', 'component', 'cross-framework'],
      license: 'MIT',
      files: ['dist', 'src', 'custom-elements.json', 'README.md']
    },
    null,
    2
  )
}

/** 免费档：仅原生单文件 + 文档 + manifest 的最小可用包 */
export function freeFiles(m: ComponentModel): FileEntry[] {
  const tag = tagNameOf(m)
  return [
    { path: `${tag}.js`, content: nativeSource(m) },
    { path: `${tag}.demo.html`, content: demoHtml(m) },
    { path: 'custom-elements.json', content: manifestJson(m) },
    { path: 'README.md', content: docsMarkdown(m) }
  ]
}

/** Pro 档：完整 npm 包结构（Lit 源码 + React/Vue wrapper + 文档 + 演示 + manifest） */
export function proFiles(m: ComponentModel): FileEntry[] {
  const tag = tagNameOf(m)
  return [
    { path: 'package.json', content: packageJson(m) },
    { path: `dist/${nativeFileName(m)}`, content: nativeSource(m) },
    { path: `src/${litFileName(m)}`, content: litSource(m) },
    { path: `src/${reactFileName(m)}`, content: reactSource(m) },
    { path: `src/${vueFileName(m)}`, content: vueSource(m) },
    { path: 'custom-elements.json', content: manifestJson(m) },
    { path: 'README.md', content: docsMarkdown(m) },
    { path: `demo/${tag}.html`, content: demoHtml(m) }
  ]
}

export function zipName(m: ComponentModel, pro: boolean): string {
  return `${tagNameOf(m)}${pro ? '-npm' : '-webcomponent'}.zip`
}

export function buildZip(files: FileEntry[]): Uint8Array {
  const obj: Record<string, Uint8Array> = {}
  for (const f of files) obj[f.path] = strToU8(f.content)
  return zipSync(obj, { level: 9 })
}

/** 导出模型（用于备份 / 再次导入） */
export function modelToJson(m: ComponentModel): string {
  return JSON.stringify(m, null, 2)
}

export function modelFileName(m: ComponentModel): string {
  return `${tagNameOf(m)}.model.json`
}
