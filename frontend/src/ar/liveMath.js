export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function overlap(a, b) {
  const w = Math.max(
    0,
    Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]),
  );
  const h = Math.max(
    0,
    Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]),
  );
  return (w * h) / Math.max(1e-6, a[2] * a[3] + b[2] * b[3] - w * h);
}
export function validBox(b) {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every(Number.isFinite) &&
    b[0] >= 0 &&
    b[1] >= 0 &&
    b[2] > 0.02 &&
    b[3] > 0.02 &&
    b[0] + b[2] <= 1.01 &&
    b[1] + b[3] <= 1.01
  );
}
export function sameObject(a, b) {
  if (overlap(a, b) > 0.5) return true;
  const areaA = a[2] * a[3],
    areaB = b[2] * b[3];
  const intersection =
    Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  // Whole packet + inset mask of the same packet. Keep adjacent packets distinct.
  return (
    intersection / Math.min(areaA, areaB) > 0.88 &&
    Math.min(areaA, areaB) / Math.max(areaA, areaB) > 0.2
  );
}
export function smoothBox(previous, next) {
  if (!previous) return [...next];
  return next.map((v, i) =>
    Math.abs(v - previous[i]) < 0.003
      ? previous[i]
      : previous[i] + 0.3 * (v - previous[i]),
  );
}
export function dedupe(detections) {
  const out = [];
  for (const d of detections
    .filter(
      (d) =>
        validBox(d.bbox) &&
        d.bbox[2] * d.bbox[3] > 0.015 &&
        d.bbox[2] * d.bbox[3] < 0.95,
    )
    .sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3])) {
    const same = out.find((x) => sameObject(x.bbox, d.bbox));
    if (same) same.prompts = [...new Set([...same.prompts, d.prompt])];
    else out.push({ ...d, prompts: [d.prompt] });
  }
  return out;
}
export function signature(frame, width, height, box = [0, 0, 1, 1]) {
  const values = [];
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const px = clamp(
        Math.floor((box[0] + ((x + 0.5) * box[2]) / 12) * width),
        0,
        width - 1,
      );
      const py = clamp(
        Math.floor((box[1] + ((y + 0.5) * box[3]) / 12) * height),
        0,
        height - 1,
      );
      values.push(frame[py * width + px]);
    }
  return values;
}
export function difference(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  return (
    a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / (a.length * 255)
  );
}
export function sharpness(frame, width, height, box) {
  let total = 0,
    count = 0;
  for (
    let y = Math.max(1, Math.floor(box[1] * height));
    y < Math.min(height - 1, (box[1] + box[3]) * height);
    y += 2
  )
    for (
      let x = Math.max(1, Math.floor(box[0] * width));
      x < Math.min(width - 1, (box[0] + box[2]) * width);
      x += 2
    ) {
      const i = y * width + x;
      total += Math.abs(
        4 * frame[i] -
          frame[i - 1] -
          frame[i + 1] -
          frame[i - width] -
          frame[i + width],
      );
      count++;
    }
  return count ? total / count : 0;
}
export function contains(box, point) {
  return (
    point.x >= box[0] &&
    point.x <= box[0] + box[2] &&
    point.y >= box[1] &&
    point.y <= box[1] + box[3]
  );
}
// Palm-normalized aperture avoids changing text size just by moving toward camera.
export function handPointer(points) {
  if (!points || points.length < 21) return null;
  const palm = Math.hypot(
    points[5].x - points[17].x,
    points[5].y - points[17].y,
  );
  if (palm < 0.025) return null;
  return {
    x: (points[4].x + points[8].x) / 2,
    y: (points[4].y + points[8].y) / 2,
    aperture:
      Math.hypot(points[4].x - points[8].x, points[4].y - points[8].y) / palm,
  };
}
// Dwell to select, open/close fingers to resize; moving off the card releases.
export function resizeGesture(state, pointer, cards, now) {
  if (!pointer) return { state: null };
  if (state?.locked) {
    const card = cards.find((c) => c.id === state.id);
    const inside = (box) =>
      box &&
      contains(
        [box[0] - 0.08, box[1] - 0.08, box[2] + 0.16, box[3] + 0.16],
        pointer,
      );
    if (!card || (!inside(card.box) && !inside(state.anchorBox)))
      return { state: null };
    const desired = clamp(
      state.scale + (pointer.aperture - state.aperture) * 0.8,
      0.8,
      1.85,
    );
    return { state, id: state.id, scale: desired };
  }
  const card = cards.find((c) => contains(c.box, pointer));
  if (!card || pointer.aperture > 0.28) return { state: null };
  if (state?.id !== card.id) return { state: { id: card.id, since: now } };
  if (now - state.since < 300) return { state };
  return {
    state: {
      ...state,
      locked: true,
      scale: card.scale,
      aperture: pointer.aperture,
      anchorBox: [...card.box],
    },
    id: card.id,
    scale: card.scale,
  };
}
