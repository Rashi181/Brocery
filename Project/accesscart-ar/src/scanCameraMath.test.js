import test from 'node:test'
import assert from 'node:assert/strict'
import { fitCapture, focusPoint } from './scanCameraMath.js'
test('captures preserve aspect ratio and stay below backend pixel limit', () => {
  assert.deepEqual(fitCapture(4000,3000), {width:1920,height:1440})
  assert.deepEqual(fitCapture(1080,1920), {width:1080,height:1920})
  assert.deepEqual(fitCapture(640,480), {width:640,height:480})
  const size = fitCapture(4000,4000)
  assert.ok(size.width*size.height < 4000000)
  assert.throws(() => fitCapture(0,0))
})
test('tap coordinates account for vertical and horizontal letterboxing', () => {
  assert.deepEqual(focusPoint(100,100,200,200,400,200), {x:.5,y:.5})
  assert.equal(focusPoint(100,20,200,200,400,200),null)
  assert.deepEqual(focusPoint(100,100,200,200,200,400), {x:.5,y:.5})
  assert.equal(focusPoint(20,100,200,200,200,400),null)
  assert.equal(focusPoint(1,1,200,200,0,0),null)
})
