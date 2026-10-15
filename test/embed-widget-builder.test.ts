import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, templateOf } from '../src/tools/embed-widget-builder/lib/templates.ts'
import { widgetSource, widgetTag, widgetFileName, safeId } from '../src/tools/embed-widget-builder/lib/gen.ts'
import { embedSnippet, standaloneDoc } from '../src/tools/embed-widget-builder/lib/snippet.ts'
import { toCSV } from '../src/tools/embed-widget-builder/lib/data.ts'

const contact = templateOf('contact').defaults()
const calc = templateOf('calculator').defaults()

test('模板注册表：5 类模板齐全，计算器/倒计时标记为 Pro，其余免费', () => {
  assert.equal(TEMPLATES.length, 5)
  assert.deepEqual(TEMPLATES.filter((t) => t.pro).map((t) => t.kind), ['calculator', 'countdown'])
  assert.deepEqual(TEMPLATES.filter((t) => !t.pro).map((t) => t.kind), ['contact', 'feedback', 'rating'])
})

test('默认配置：id 为 6 位合法标签片段，标签可安全用于自定义元素', () => {
  for (const t of TEMPLATES) {
    const c = t.defaults()
    assert.match(c.id, /^[a-z0-9]{6}$/)
    assert.equal(widgetTag(c), 'widget-fz-' + c.id)
    assert.match(widgetFileName(c), /^widget-fz-[a-z0-9]{6}\.js$/)
  }
  assert.equal(safeId('A B/C!'), 'abc')
})

test('contact 默认含 3 个字段，calculator 默认计价参数完整', () => {
  assert.equal(contact.fields?.length, 3)
  assert.ok(contact.fields?.every((f) => f.name && f.label))
  assert.ok(calc.calc && calc.calc.unitPrice >= 0 && calc.calc.currency === '¥')
})

test('widgetSource：自包含脚本含 Shadow DOM、customElements.define 与内嵌 JSON 配置', () => {
  const src = widgetSource(contact)
  assert.ok(src.includes('customElements.define(TAG, FzWidget)'))
  assert.ok(src.includes("'widget-fz-'"))
  assert.ok(src.includes('"id":"' + contact.id + '"'))
  assert.ok(src.includes('attachShadow(') && src.includes("'open'"))
  assert.ok(src.includes('https://fangzi.app'))
})

test('widgetSource：poweredBy 开关写入配置，Pro 关闭后产物标记 poweredBy:false', () => {
  const on = templateOf('rating').defaults()
  on.poweredBy = true
  assert.ok(widgetSource(on).includes('"poweredBy":true'))
  const off = templateOf('rating').defaults()
  off.poweredBy = false
  const srcOff = widgetSource(off)
  assert.ok(srcOff.includes('"poweredBy":false'))
  assert.ok(!srcOff.includes('"poweredBy":true'))
})

test('widgetSource 安全：用户文本中的 </script> 被 Unicode 转义，运行时不含反引号', () => {
  const c = templateOf('contact').defaults()
  c.title = '</script><img src=x>'
  const src = widgetSource(c)
  assert.ok(!src.includes('</script'))
  assert.ok(!src.includes('<img'))
  assert.ok(src.includes('\\u003c/script'))
  assert.ok(!src.includes('`'))
})

test('embedSnippet：空域名给相对路径，有域名给版本化 URL widgets/v1/<id>.js', () => {
  const rel = embedSnippet(contact, '')
  assert.ok(rel.includes('src="widget-fz-' + contact.id + '.js"'))
  assert.ok(rel.includes('data-key="' + contact.id + '"'))
  const abs = embedSnippet(contact, 'https://a.com/')
  assert.ok(abs.includes('src="https://a.com/widgets/v1/' + contact.id + '.js"'))
})

test('standaloneDoc：含自定义元素标签与内联脚本，可独立打开', () => {
  const doc = standaloneDoc(contact, true)
  assert.ok(doc.includes('<widget-fz-' + contact.id))
  assert.ok(doc.includes('data-preview="1"'))
  assert.ok(doc.includes('<script>') && doc.includes('customElements.define'))
  assert.equal((doc.match(/<\/script>/g) || []).length, 1)
})

test('toCSV：表头并集、逗号/引号转义、UTF-8 BOM 与中文', () => {
  const csv = toCSV([
    { name: '张三,工程师', note: '他说"好"', score: 5 },
    { name: '李四', score: 4 }
  ])
  assert.ok(csv.charCodeAt(0) === 0xfeff)
  const lines = csv.replace(/^﻿/, '').split('\n')
  assert.equal(lines[0], 'name,note,score')
  assert.ok(lines[1].includes('"张三,工程师"'))
  assert.ok(lines[1].includes('"他说""好"""'))
  assert.equal(toCSV([]), '')
})
