import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import {
  emptyModel, tagNameOf, isValidTagName, toClassName, camelToKebab, slug
} from '../src/tools/wc-workbench/lib/model.ts'
import { jsStr } from '../src/tools/wc-workbench/lib/code.ts'
import { nativeSource, nativeFileName } from '../src/tools/wc-workbench/lib/generate/native.ts'
import { litSource, litFileName } from '../src/tools/wc-workbench/lib/generate/lit.ts'
import { reactSource, reactFileName, vueSource, vueFileName } from '../src/tools/wc-workbench/lib/generate/wrappers.ts'
import { manifestJson, manifestObject } from '../src/tools/wc-workbench/lib/manifest-gen.ts'
import { docsMarkdown } from '../src/tools/wc-workbench/lib/docs.ts'
import { freeFiles, proFiles, buildZip } from '../src/tools/wc-workbench/lib/export.ts'
import { sanitizeModel, FREE_LIBRARY_LIMIT } from '../src/tools/wc-workbench/lib/storage.ts'

const m = emptyModel('My Button')
const tag = tagNameOf(m)

test('模型工具：标签名合法、含连字符、全小写；类名/属性转换正确', () => {
  assert.equal(tag, 'wc-my-button')
  assert.ok(isValidTagName(tag))
  assert.ok(isValidTagName('acme-foo-bar'))
  assert.ok(!isValidTagName('mybutton'))      // 无连字符
  assert.ok(!isValidTagName('My-Button'))     // 大写
  assert.equal(toClassName('foo bar/baz'), 'FooBarBaz')
  assert.equal(camelToKebab('myPropName'), 'my-prop-name')
  assert.equal(slug('Hello World!'), 'hello-world')
})

test('默认模型：含 label/disabled 属性、press 事件、默认+icon 插槽、2 个 CSS 变量', () => {
  assert.equal(m.properties.length, 2)
  assert.equal(m.events[0].name, 'press')
  assert.ok(m.slots.some((s) => s.name === ''))
  assert.ok(m.slots.some((s) => s.name === 'icon'))
  assert.equal(m.cssVars.length, 2)
})

test('原生生成：包含 class/observedAttributes/define/getter-setter/CustomEvent/slot/css 变量', () => {
  const src = nativeSource(m)
  const q = `["']` // jsStr 产出双引号，断言对引号风格保持宽容
  assert.match(src, /class MyButton extends HTMLElement/)
  assert.match(src, /observedAttributes/)
  assert.match(src, new RegExp(`customElements\\.define\\(${q}${tag}${q}`))
  assert.match(src, new RegExp(`Object\\.defineProperty\\(this, ${q}label${q}`))
  assert.match(src, /attributeChangedCallback/)
  assert.match(src, /emitPress/)
  assert.match(src, new RegExp(`new CustomEvent\\(${q}press${q}`))
  // shadow 结构整体经 jsStr 转义，尖括号被 unicode 转义，断言 slot 片段存在即可
  assert.ok(src.includes('slot name='))
  assert.match(src, /--primary-color/)
  assert.equal(nativeFileName(m), `${tag}.js`)
  // 幂等：重复 define 有保护
  assert.match(src, /if \(!customElements\.get\(/)
})

test('安全：用户文本含 </script> 时生成源码不出现原始闭合序列', () => {
  const evil = structuredClone(m)
  evil.description = 'x</script><img src=x onerror=alert(1)>'
  evil.properties[0].default = '</script><script>alert(1)</script>'
  const src = nativeSource(evil)
  assert.ok(!src.includes('</script>'), '原生源码不应含原始 </script>')
  assert.ok(src.includes('\\u003c'), '应将 < 转义为 \\u003c')
  // jsStr 直接验证
  assert.equal(JSON.parse(jsStr('</script>').replace(/\\u003c/g, '<')), '</script>')
})

test('Lit 生成：@customElement/@property/css/emits/TagNameMap 齐全', () => {
  const src = litSource(m)
  const q = `["']`
  assert.match(src, new RegExp(`@customElement\\(${q}wc-my-button${q}\\)`))
  assert.match(src, /@property\(\) label: string/)
  assert.match(src, /@property\(\{ type: Boolean \}\) disabled/)
  assert.match(src, /emitPress/)
  assert.match(src, /HTMLElementTagNameMap/)
  assert.match(src, /from 'lit'/)
  assert.equal(litFileName(m), `${tag}.ts`)
})

test('wrapper：React createComponent 含 tagName 与 on<Event>；Vue defineComponent 含标签', () => {
  const r = reactSource(m)
  const q = `["']`
  assert.match(r, /createComponent\(/)
  assert.match(r, new RegExp(`tagName: ${q}wc-my-button${q}`))
  assert.match(r, new RegExp(`onPress: ${q}press${q}`))
  assert.match(r, /MyButtonReact/)
  assert.equal(reactFileName(m), `${tag}.react.tsx`)
  const v = vueSource(m)
  assert.match(v, /defineComponent\(/)
  assert.match(v, new RegExp(`${q}wc-my-button${q}`))
  assert.match(v, /emits:/)
  assert.match(v, /onPress/)
  assert.equal(vueFileName(m), `${tag}.vue.ts`)
})

test('custom-elements.json：可解析、schema 1.0.0，字段/事件/插槽/变量计数正确', () => {
  const parsed = JSON.parse(manifestJson(m))
  assert.equal(parsed.schemaVersion, '1.0.0')
  const decl = parsed.modules[0].declarations[0]
  assert.equal(decl.tagName, tag)
  assert.equal(decl.customElement, true)
  assert.equal(decl.attributes.length, 2)
  const attrNames = decl.attributes.map((a: { name: string }) => a.name)
  assert.deepEqual(attrNames, ['label', 'disabled'])
  assert.equal(decl.events.length, 1)
  assert.equal(decl.events[0].name, 'press')
  // 默认插槽无 name 字段
  assert.ok(decl.slots.some((s: { name?: string }) => !('name' in s)))
  assert.equal(decl.cssProperties.length, 2)
  // 自定义元素导出项存在
  assert.ok(parsed.modules[0].exports.some((e: { kind: string }) => e.kind === 'custom-element-definition'))
  assert.equal(typeof manifestObject(m).schemaVersion, 'string')
})

test('API 文档：含用法代码块与属性/事件/插槽/CSS 变量四个表', () => {
  const md = docsMarkdown(m)
  assert.match(md, new RegExp(`<${tag}`))
  for (const h of ['## 属性 / Attributes', '## 事件', '## 插槽', '## CSS 变量']) assert.ok(md.includes(h), h)
  assert.ok(md.includes('`label`'))
  assert.ok(md.includes('`press`'))
})

test('导出：免费 zip 含组件/demo/manifest/README；Pro zip 额外含 package.json 与 Lit+React+Vue', () => {
  const freeZip = buildZip(freeFiles(m))
  assert.ok(freeZip instanceof Uint8Array && freeZip.length > 0)
  const freeMap = unzipSync(freeZip)
  const freePaths = Object.keys(freeMap)
  assert.ok(freePaths.includes(`${tag}.js`))
  assert.ok(freePaths.includes(`${tag}.demo.html`))
  assert.ok(freePaths.includes('custom-elements.json'))
  assert.ok(freePaths.includes('README.md'))
  // README 即文档
  assert.match(strFromU8(freeMap['README.md']), /# MyButton/)

  const proZip = buildZip(proFiles(m))
  const proPaths = Object.keys(unzipSync(proZip))
  for (const p of ['package.json', `dist/${tag}.js`, `src/${tag}.ts`, `src/${tag}.react.tsx`, `src/${tag}.vue.ts`, 'custom-elements.json', 'README.md'])
    assert.ok(proPaths.includes(p), p)
  const pkg = JSON.parse(strFromU8(unzipSync(proZip)['package.json']))
  assert.equal(pkg.name, tag)
  assert.equal(pkg.customElements, 'custom-elements.json')
})

test('导入校验：合法模型通过；非法对象抛错；字段类型归一化', () => {
  assert.equal(FREE_LIBRARY_LIMIT, 3)
  const ok = sanitizeModel({
    className: 'Card', prefix: 'acme', description: 'd',
    properties: [{ name: 'size', type: 'weird' as unknown, default: 5 as unknown }],
    events: [{ name: 'change' }], slots: [], cssVars: [{ name: 'c', default: '#000' }]
  })
  assert.equal(ok.className, 'Card')
  assert.equal(ok.properties[0].type, 'string') // 未知类型归一
  assert.equal(ok.properties[0].default, '5')
  assert.throws(() => sanitizeModel(null), /模型不是对象/)
  assert.throws(() => sanitizeModel({ prefix: 'a' }), /缺少 className/)
  assert.throws(() => sanitizeModel({ className: 'X', prefix: 'a', properties: [{ type: 'string' }] }), /存在非法属性/)
})
