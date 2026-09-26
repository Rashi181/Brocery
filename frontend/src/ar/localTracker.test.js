import test from "node:test";
import assert from "node:assert/strict";
import { seedTrack, moveTrack, centerCandidate } from "./localTracker.js";
test("local tracker follows a translated textured product", () => {
  const width = 100,
    height = 100,
    a = new Uint8Array(width * height),
    b = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      a[y * width + x] = (x * 37 + y * 53 + x * y * 7) % 255;
  for (let y = 0; y < height - 4; y++)
    for (let x = 0; x < width - 6; x++)
      b[(y + 4) * width + x + 6] = a[y * width + x];
  const seed = seedTrack(a, width, height, [0.3, 0.3, 0.3, 0.3]),
    next = moveTrack(seed, b, width, height);
  assert.ok(next);
  assert.ok(Math.abs(next.box[0] - 0.36) < 0.01);
  assert.ok(Math.abs(next.box[1] - 0.34) < 0.01);
});
test("flat frames are not treated as a tracked product", () =>
  assert.equal(
    seedTrack(new Uint8Array(10000), 100, 100, [0.2, 0.2, 0.3, 0.3]),
    null,
  ));
test("center grab chooses the centered substantial candidate", () =>
  assert.equal(
    centerCandidate([
      { prompt: "left", bbox: [0.01, 0.1, 0.2, 0.2] },
      { prompt: "held", bbox: [0.3, 0.25, 0.4, 0.5] },
    ]).prompt,
    "held",
  ));
