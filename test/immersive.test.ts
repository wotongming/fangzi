import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useImmersive } from '../src/composables/useImmersive'

// Node 无 document：canFullscreen=false，enter/exit 走应用内沉浸分支，不依赖系统全屏
const imm = useImmersive()

test('初始非沉浸', () => {
  assert.equal(imm.active.value, false)
})

test('enter 进入应用内沉浸态', async () => {
  await imm.enter()
  assert.equal(imm.active.value, true)
})

test('exit 退出沉浸态', async () => {
  await imm.exit()
  assert.equal(imm.active.value, false)
})

test('toggle 在进/退之间切换', async () => {
  await imm.toggle()
  assert.equal(imm.active.value, true)
  await imm.toggle()
  assert.equal(imm.active.value, false)
})

test('同一单例状态在多次获取间共享', async () => {
  const a = useImmersive()
  const b = useImmersive()
  await a.enter()
  assert.equal(b.active.value, true)
  await a.exit()
  assert.equal(b.active.value, false)
})
