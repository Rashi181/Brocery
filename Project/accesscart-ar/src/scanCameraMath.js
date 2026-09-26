export function fitCapture(width, height, maxSide = 1920) {
  if (!(width > 0 && height > 0)) throw new Error('Camera is not ready')
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// Preview uses object-fit: contain; taps in letterboxing must not focus elsewhere.
export function focusPoint(x, y, boxWidth, boxHeight, videoWidth, videoHeight) {
  if (!(boxWidth > 0 && boxHeight > 0 && videoWidth > 0 && videoHeight > 0)) return null
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight)
  const width = videoWidth * scale, height = videoHeight * scale
  const px = (x - (boxWidth - width) / 2) / width
  const py = (y - (boxHeight - height) / 2) / height
  return px < 0 || px > 1 || py < 0 || py > 1 ? null : { x: px, y: py }
}
