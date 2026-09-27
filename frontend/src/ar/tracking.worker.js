import { seedTrack, moveTrack } from "./localTracker.js";
import {
  clamp,
  contains,
  dedupe,
  sameObject,
  smoothBox,
  signature,
  difference,
  sharpness,
} from "./liveMath.js";

let tracks = [],
  history = [],
  nextId = 0,
  hands = [];
const W = 160,
  H = 160;
self.onmessage = ({ data }) => {
  if (data.type === "hands") {
    hands = data.points;
    return;
  }
  if (data.type === "verified") {
    const t = tracks.find((t) => t.id === data.id);
    if (t) t.needsIdentity = false;
    return;
  }
  if (data.type === "reset") {
    tracks = [];
    history = [];
    return;
  }
  if (data.type === "frame") {
    history.push(data);
    history = history.filter((f) => data.time - f.time < 10000);
    tracks = tracks.flatMap((t) => {
      let moved = moveTrack(t.local, data.gray, W, H);
      const grip = hands.filter(
        (h) => data.time - h.time < 650 && contains(t.box, h),
      );
      const hand = grip.length === 1 ? grip[0] : null;
      let needsIdentity = t.needsIdentity;
      // Short continuity bridge for a turn, never a verified identity assumption.
      if (!moved && hand && t.hand && data.time - (t.recoveredAt || 0) > 2500) {
        const box = [
          clamp(t.box[0] + hand.x - t.hand.x, 0, 1 - t.box[2]),
          clamp(t.box[1] + hand.y - t.hand.y, 0, 1 - t.box[3]),
          t.box[2],
          t.box[3],
        ];
        moved = seedTrack(data.gray, W, H, box);
        needsIdentity = true;
        t.recoveredAt = data.time;
        t.generation = (t.generation || 0) + 1;
      }
      if (!moved) {
        const missingSince = t.missingSince ?? data.time;
        // Brief misses don't create new cards. Hide checks during this grace period.
        return data.time - missingSince < 420
          ? [{ ...t, missingSince, lost: true }]
          : [];
      }
      if (t.lost && moved.error > 12) {
        needsIdentity = true;
        t.generation = (t.generation || 0) + 1;
      }
      const sig = signature(data.gray, W, H, moved.box);
      const stable = difference(sig, t.signature) < 0.06;
      const fresh = seedTrack(data.gray, W, H, moved.box);
      // Adapt slowly; rapid turns are reacquired by automatic detection.
      if (fresh && moved.error < 12)
        moved.template = moved.template.map(
          (v, i) => v * 0.95 + fresh.template[i] * 0.05,
        );
      return [
        {
          ...t,
          local: moved,
          box: moved.box,
          displayBox: smoothBox(t.displayBox, moved.box),
          missingSince: null,
          lost: false,
          signature: sig,
          hand,
          needsIdentity,
          stableSince: stable ? t.stableSince : data.time,
          sharp: sharpness(data.gray, W, H, moved.box),
        },
      ];
    });
    const unique = [];
    for (const t of tracks) {
      const existing = unique.find(
        (x) => !x.lost && !t.lost && sameObject(x.box, t.box),
      );
      if (existing)
        existing.prompts = [...new Set([...existing.prompts, ...t.prompts])];
      else unique.push(t);
    }
    tracks = unique;
    self.postMessage({
      type: "tracks",
      sequence: data.sequence,
      time: data.time,
      tracks: tracks.map((t) => ({
        id: t.id,
        box: t.box,
        displayBox: t.displayBox,
        slot: t.slot,
        lost: t.lost || false,
        prompts: t.prompts,
        signature: t.signature,
        stableSince: t.stableSince,
        sharp: t.sharp,
        needsIdentity: t.needsIdentity,
        generation: t.generation || 0,
      })),
    });
  }
  if (data.type === "detections") {
    const start = history.findIndex((f) => f.sequence === data.sequence);
    if (start < 0) {
      self.postMessage({ type: "stale" });
      return;
    }
    const frames = history.slice(start);
    for (const d of dedupe(data.detections)) {
      let local = seedTrack(frames[0].gray, W, H, d.bbox);
      for (const f of frames.slice(1)) {
        if (local) local = moveTrack(local, f.gray, W, H);
      }
      if (!local) continue;
      const existing = tracks.find((t) => sameObject(t.box, local.box));
      if (existing) {
        existing.prompts = [...new Set([...existing.prompts, ...d.prompts])];
        continue;
      }
      if (tracks.length >= 2) break;
      const latest = frames.at(-1);
      const preferred = local.box[0] + local.box[2] / 2 < 0.5 ? 0 : 1;
      const slot = tracks.some((t) => t.slot === preferred)
        ? 1 - preferred
        : preferred;
      tracks.push({
        id: `object-${++nextId}`,
        box: local.box,
        displayBox: [...local.box],
        slot,
        local,
        prompts: d.prompts,
        stableSince: latest.time,
        sharp: 0,
        signature: signature(latest.gray, W, H, local.box),
      });
    }
  }
};
