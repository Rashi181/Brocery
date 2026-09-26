// Local block-matching motion tracking. Operates on tiny grayscale frames,
// never sends video to the server; deliberately drops a low-confidence track.
export function grayscale(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++)
    out[i] =
      (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return out;
}
function patch(frame, width, height, box) {
  const samples = [];
  for (let j = 0; j < 16; j++)
    for (let i = 0; i < 16; i++) {
      const x = Math.round((box[0] + (box[2] * (i + 0.5)) / 16) * width),
        y = Math.round((box[1] + (box[3] * (j + 0.5)) / 16) * height);
      if (x < 0 || x >= width || y < 0 || y >= height) return null;
      samples.push(frame[y * width + x]);
    }
  return samples;
}
export function seedTrack(frame, width, height, box) {
  const template = patch(frame, width, height, box);
  if (!template) return null;
  const mean = template.reduce((a, b) => a + b, 0) / template.length;
  const variance =
    template.reduce((a, b) => a + (b - mean) ** 2, 0) / template.length;
  return variance < 80 ? null : { box: [...box], template, mean };
}
export function moveTrack(previous, frame, width, height) {
  let best = null;
  for (const scale of [0.94, 1, 1.06])
    for (let dy = -10; dy <= 10; dy += 2)
      for (let dx = -10; dx <= 10; dx += 2) {
        const [x, y, w, h] = previous.box,
          nw = w * scale,
          nh = h * scale;
        const box = [
            x + dx / width + (w - nw) / 2,
            y + dy / height + (h - nh) / 2,
            nw,
            nh,
          ],
          sample = patch(frame, width, height, box);
        if (!sample) continue;
        const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
        const error =
          sample.reduce(
            (sum, v, i) =>
              sum + Math.abs(v - mean - (previous.template[i] - previous.mean)),
            0,
          ) / sample.length;
        if (!best || error < best.error) best = { box, error };
      }
  if (!best || best.error > 24) return null;
  return { ...previous, box: best.box, error: best.error };
}
export function centerCandidate(detections) {
  return (
    [...detections]
      .filter((d) => d.bbox[2] * d.bbox[3] > 0.025)
      .sort((a, b) => {
        const distance = (d) =>
          Math.hypot(
            d.bbox[0] + d.bbox[2] / 2 - 0.5,
            d.bbox[1] + d.bbox[3] / 2 - 0.5,
          );
        return distance(a) - distance(b);
      })[0] || null
  );
}
