import test from "node:test";
import assert from "node:assert/strict";

test("worker replays delayed detections and drops lost objects without recycling identity", async () => {
  const messages = [];
  globalThis.self = { postMessage: (m) => messages.push(m) };
  await import("./tracking.worker.js");
  const send = (data) => globalThis.self.onmessage({ data });
  const gray = new Uint8Array(160 * 160);
  for (let y = 0; y < 160; y++)
    for (let x = 0; x < 160; x++)
      gray[y * 160 + x] = (x * 37 + y * 53 + x * y * 7) % 255;
  send({ type: "frame", gray, sequence: 1, time: 0 });
  send({ type: "frame", gray, sequence: 2, time: 120 });
  send({
    type: "detections",
    sequence: 1,
    detections: [
      { prompt: "chips", bbox: [0.1, 0.2, 0.25, 0.4] },
      { prompt: "oreo", bbox: [0.6, 0.2, 0.25, 0.4] },
    ],
  });
  send({ type: "frame", gray, sequence: 3, time: 240 });
  assert.equal(messages.at(-1).tracks.length, 2);
  const old = messages.at(-1).tracks.map((t) => t.id);
  send({
    type: "frame",
    gray: new Uint8Array(160 * 160),
    sequence: 4,
    time: 360,
  });
  assert.equal(messages.at(-1).tracks.length, 0);
  send({ type: "frame", gray, sequence: 5, time: 12000 });
  send({
    type: "detections",
    sequence: 1,
    detections: [{ prompt: "chips", bbox: [0.1, 0.2, 0.25, 0.4] }],
  });
  assert.equal(messages.at(-1).type, "stale");
  send({
    type: "detections",
    sequence: 5,
    detections: [{ prompt: "chips", bbox: [0.1, 0.2, 0.25, 0.4] }],
  });
  send({ type: "frame", gray, sequence: 6, time: 12120 });
  assert.equal(messages.at(-1).tracks.length, 1);
  assert.ok(!old.includes(messages.at(-1).tracks[0].id));
  send({ type: "reset" });
  send({ type: "frame", gray, sequence: 7, time: 12240 });
  assert.equal(messages.at(-1).tracks.length, 0);
  delete globalThis.self;
});
