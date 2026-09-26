import { Matrix4, Vector3 } from 'three'

// JPEG coordinates have already been vertically flipped to a top-left origin.
export function detectionRay(box, width, height, projection, cameraTransform) {
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Invalid detection geometry')
  const [left, top, right, bottom] = box
  if (left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) throw new Error('Detection is outside the captured image')
  // Use the base of a standing product to find its supporting surface.
  const u = (left + right) / (2 * width)
  const v = bottom / height
  const inverseProjection = new Matrix4().fromArray(projection).invert()
  const world = new Matrix4().fromArray(cameraTransform)
  const origin = new Vector3().setFromMatrixPosition(world)
  const direction = new Vector3(2 * u - 1, 1 - 2 * v, -1)
    .applyMatrix4(inverseProjection).normalize().transformDirection(world)
  return { origin, direction }
}
