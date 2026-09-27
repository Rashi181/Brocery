import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupe,
  handPointer,
  resizeGesture,
  sharpness,
  difference,
} from "./liveMath.js";

test("overlapping prompts become one object but adjacent packets stay separate", () => {
  const found = dedupe([
    { prompt: "chips", bbox: [0.1, 0.1, 0.25, 0.5] },
    { prompt: "packet", bbox: [0.11, 0.1, 0.25, 0.5] },
    { prompt: "oreo", bbox: [0.5, 0.1, 0.25, 0.5] },
    { prompt: "bad", bbox: [NaN, 0, 1, 1] },
  ]);
  assert.equal(found.length, 2);
  assert.deepEqual(found[0].prompts, ["chips", "packet"]);
});
test("pinch requires dwell over the card and never selects bare camera", () => {
  const cards = [{ id: "chips", box: [0.2, 0.2, 0.3, 0.3], scale: 1 }];
  assert.equal(
    resizeGesture(null, { x: 0.1, y: 0.1, aperture: 0.1 }, cards, 0).state,
    null,
  );
  let { state } = resizeGesture(
    null,
    { x: 0.3, y: 0.3, aperture: 0.1 },
    cards,
    0,
  );
  assert.equal(
    resizeGesture(state, { x: 0.3, y: 0.3, aperture: 0.1 }, cards, 200).id,
    undefined,
  );
  const locked = resizeGesture(
    state,
    { x: 0.3, y: 0.3, aperture: 0.1 },
    cards,
    350,
  );
  assert.equal(locked.id, "chips");
  const big = resizeGesture(
    locked.state,
    { x: 0.3, y: 0.3, aperture: 1.2 },
    cards,
    450,
  );
  assert.ok(big.scale > 1);
  assert.ok(big.scale <= 1.85);
  const small = resizeGesture(
    locked.state,
    { x: 0.3, y: 0.3, aperture: 0.1 },
    cards,
    500,
  );
  assert.equal(small.scale, 1);
  assert.equal(resizeGesture(locked.state, null, cards, 600).state, null);
  assert.equal(
    resizeGesture(locked.state, { x: 0.9, y: 0.9, aperture: 0.1 }, cards, 700)
      .state,
    null,
  );
});
test("hand depth changes do not change palm-normalized aperture", () => {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[5] = { x: 0.4, y: 0.5 };
  points[17] = { x: 0.6, y: 0.5 };
  points[4] = { x: 0.45, y: 0.4 };
  points[8] = { x: 0.55, y: 0.4 };
  const larger = points.map((p) => ({
    x: (p.x - 0.5) * 1.5 + 0.5,
    y: (p.y - 0.5) * 1.5 + 0.5,
  }));
  assert.ok(
    Math.abs(handPointer(points).aperture - handPointer(larger).aperture) <
      1e-9,
  );
});
test("flat unreadable views cannot trigger a sharp-label check", () => {
  const flat = new Uint8Array(160 * 160).fill(100);
  assert.equal(sharpness(flat, 160, 160, [0, 0, 1, 1]), 0);
  assert.equal(difference([40, 50], [40, 50]), 0);
});
