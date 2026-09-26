import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Matrix4, Vector3 } from 'three'
import { detectionRay } from './detectionRay.js'
const camera = new PerspectiveCamera(90, 1, 0.1, 100)
const projection = camera.projectionMatrix.toArray()
const identity = new Matrix4().toArray()
test('JPEG bottom-center maps to the captured camera ray', () => {
  const { direction } = detectionRay([40, 20, 60, 50], 100, 100, projection, identity)
  assert.ok(direction.distanceTo(new Vector3(0, 0, -1)) < 1e-8)
  const below = detectionRay([40, 50, 60, 75], 100, 100, projection, identity)
  assert.ok(below.direction.y < 0)
})
test('uses capture pose and preserves coordinates after resizing', () => {
  const transform = new Matrix4().makeRotationY(Math.PI / 2).setPosition(1, 2, 3).toArray()
  const first = detectionRay([40, 20, 60, 50], 100, 100, projection, transform)
  const scaled = detectionRay([80, 40, 120, 100], 200, 200, projection, transform)
  assert.ok(first.origin.distanceTo(new Vector3(1, 2, 3)) < 1e-8)
  assert.ok(first.direction.distanceTo(new Vector3(-1, 0, 0)) < 1e-8)
  assert.ok(first.direction.distanceTo(scaled.direction) < 1e-8)
})
test('rejects invalid boxes', () => {
  assert.throws(() => detectionRay([0, 0, 200, 50], 100, 100, projection, identity))
})
