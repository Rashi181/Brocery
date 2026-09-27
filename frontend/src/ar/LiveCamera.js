import { api } from "../api";
import { grayscale } from "./localTracker";
import {
  clamp,
  contains,
  difference,
  handPointer,
  resizeGesture,
  signature,
} from "./liveMath";

// One camera owner. Rendering never awaits inference. Workers handle all tracking.
export class LiveCamera {
  constructor(video, tripId, callbacks, services = api) {
    this.api = services;
    this.video = video;
    this.tripId = tripId;
    this.cb = callbacks;
    this.items = [];
    this.tracks = [];
    this.readings = new Map();
    this.scales = new Map();
    this.sequence = 0;
    this.controllers = new Set();
    this.closed = false;
    this.nextDetect = 0;
    this.nextRead = 0;
    this.errors = 0;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = 160;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.trackWorker = new Worker(
      new URL("./tracking.worker.js", import.meta.url),
      { type: "module" },
    );
    this.trackWorker.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data.type === "stale") {
        this.nextDetect = performance.now() + 1500;
        return;
      }
      if (data.type !== "tracks") return;
      this.trackingBusy = false;
      this.tracks = data.tracks;
      const ids = new Set(this.tracks.map((t) => t.id));
      for (const id of this.readings.keys())
        if (!ids.has(id)) {
          this.readings.delete(id);
          this.scales.delete(id);
        }
      this.publish();
    };
    this.trackWorker.onerror = () =>
      this.fail("Tracking could not start. Reload the camera.", true);
    this.handWorker = new Worker("/hand-worker.js");
    this.handWorker.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data.type === "ready") {
        this.handsReady = true;
        this.cb.gesture(
          "Air pinch: resize · move away: release · open fingers near a card’s top/bottom edge: scroll",
        );
      }
      if (data.type === "error") this.cb.gesture(data.message);
      if (data.type === "inference-error") {
        this.handsReady = false;
        this.handsBusy = false;
        this.cb.gesture(
          "Hand tracking could not run on this browser. Automatic product checks remain active.",
        );
      }
      if (data.type === "hands") {
        this.handsBusy = false;
        if (performance.now() - data.time > 600 || this.paused) return;
        this.hands = data.landmarks;
        this.lastHands = performance.now();
        this.trackWorker.postMessage({
          type: "hands",
          points: data.landmarks.map((h) => ({ ...h[9], time: data.time })),
        });
        this.gestures();
      }
    };
    this.handWorker.onerror = () => {
      this.handsReady = false;
      this.cb.gesture(
        "Hand gestures unavailable; automatic scanning remains active.",
      );
    };
    this.handWorker.postMessage({ type: "init", base: location.origin });
    this.cb.gesture("Loading on-device hand tracking…");
    this.onVisibility = () => {
      if (document.hidden) {
        this.controllers.forEach((c) => c.abort());
        this.trackWorker.postMessage({ type: "reset" });
        this.tracks = [];
        this.readings.clear();
        this.trackingBusy = false;
        this.gestureState = null;
        this.cb.pointer(null);
        this.publish();
      } else {
        this.nextDetect = 0;
        this.nextRead = 0;
      }
    };
    document.addEventListener("visibilitychange", this.onVisibility);
  }
  async start(providedStream) {
    try {
      const stream =
        providedStream ||
        (await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        }));
      if (this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (this.closed) return;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() || {};
      if (capabilities.focusMode?.includes("continuous"))
        await track
          .applyConstraints({ advanced: [{ focusMode: "continuous" }] })
          .catch(() => {});
      if (this.closed) return;
      track.onended = () =>
        this.fail(
          "Camera stopped. Allow camera access and reopen this aisle.",
          true,
        );
      this.cb.ready(this.video.videoWidth / this.video.videoHeight);
      this.cb.status("Looking for products automatically");
      this.timer = setInterval(() => this.tick(), 120);
    } catch (e) {
      if (!this.closed)
        this.fail(
          e.name === "NotAllowedError"
            ? "Allow camera access in Chrome, then reopen this aisle."
            : `Camera unavailable: ${e.message}`,
          true,
        );
    }
  }
  setItems(items) {
    this.items = items;
  }
  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      this.gestureState = null;
      this.cb.pointer(null);
    }
  }
  fail(message, fatal = false) {
    this.cb.error(message);
    if (fatal) this.fatal = true;
  }
  publish() {
    this.cb.tracks(
      this.tracks.map((t) => ({
        ...t,
        reading: this.readings.get(t.id),
        scale: this.scales.get(t.id) || 1,
        held: this.heldId === t.id,
        resizing: this.gestureState?.locked && this.gestureState.id === t.id,
      })),
    );
  }
  gestures() {
    const hands = this.hands || [];
    const cards = this.cb.cards();
    // Prefer the hand hovering over a card, not the hand holding the packet.
    const pointers = hands.map(handPointer).filter(Boolean);
    let pointer = pointers.find((p) => cards.some((c) => contains(c.box, p)));
    if (this.gestureState?.locked && this.previousPointer)
      pointer = pointers
        .slice()
        .sort(
          (a, b) =>
            Math.hypot(
              a.x - this.previousPointer.x,
              a.y - this.previousPointer.y,
            ) -
            Math.hypot(
              b.x - this.previousPointer.x,
              b.y - this.previousPointer.y,
            ),
        )[0];
    this.previousPointer = pointer;
    const update = resizeGesture(
      this.gestureState,
      pointer,
      cards,
      performance.now(),
    );
    this.gestureState = update.state;
    if (update.id) {
      const old = this.scales.get(update.id) || 1;
      this.scales.set(update.id, old * 0.65 + update.scale * 0.35);
    }
    this.cb.pointer(
      pointer ? { ...pointer, locked: !!update.state?.locked } : null,
    );
    const hovered = pointer && cards.find((c) => contains(c.box, pointer));
    const relative = hovered
      ? (pointer.y - hovered.box[1]) / hovered.box[3]
      : 0.5;
    const direction = relative < 0.16 ? -1 : relative > 0.8 ? 1 : 0;
    if (
      hovered &&
      !update.state?.locked &&
      pointer.aperture > 0.6 &&
      direction
    ) {
      const key = hovered.id + direction;
      if (this.scrollHover?.key !== key)
        this.scrollHover = { key, since: performance.now() };
      else if (performance.now() - this.scrollHover.since > 400)
        this.cb.scroll?.(hovered.id, direction * 12);
    } else this.scrollHover = null;
    // A hand overlapping a product prioritizes its next read. It does not prove identity.
    this.heldId = this.tracks.find((t) =>
      hands.some(
        (h) =>
          contains(t.box, h[9]) &&
          !cards.some((c) =>
            contains(c.box, handPointer(h) || { x: -1, y: -1 }),
          ),
      ),
    )?.id;
    this.publish();
  }
  tick() {
    if (
      this.closed ||
      this.fatal ||
      document.hidden ||
      this.paused ||
      this.video.readyState < 2 ||
      !this.items.length
    )
      return;
    const now = performance.now();
    if (now - (this.lastHands || 0) > 650) {
      this.hands = [];
      this.gestureState = null;
      this.heldId = null;
      this.cb.pointer(null);
    }
    this.context.drawImage(this.video, 0, 0, 160, 160);
    this.gray = grayscale(this.context.getImageData(0, 0, 160, 160).data);
    if (!this.trackingBusy) {
      this.sequence++;
      this.trackingBusy = true;
      this.trackWorker.postMessage({
        type: "frame",
        gray: this.gray,
        sequence: this.sequence,
        time: now,
      });
    }
    if (this.handsReady && !this.handsBusy) {
      this.handsBusy = true;
      createImageBitmap(this.video, {
        resizeWidth: 480,
        resizeHeight: Math.round(
          (480 * this.video.videoHeight) / this.video.videoWidth,
        ),
      })
        .then((image) => {
          if (this.closed) image.close();
          else
            this.handWorker.postMessage({ type: "frame", image, time: now }, [
              image,
            ]);
        })
        .catch(() => {
          this.handsBusy = false;
        });
    }
    const scene = signature(this.gray, 160, 160);
    const changed = difference(scene, this.lastScene) > 0.09;
    const morePrompts = new Set(this.items.map((i) => i.item)).size > 5;
    if (
      !this.detecting &&
      now >= this.nextDetect &&
      (!this.tracks.length ||
        changed ||
        (morePrompts && now - (this.lastDetected || 0) > 25000))
    )
      this.detect(scene);
    if (!this.reading && now >= this.nextRead) {
      const candidates = this.tracks
        .filter((t) => {
          const old = this.readings.get(t.id);
          return (
            t.sharp >= 9 &&
            now - t.stableSince > 500 &&
            (!old ||
              (!old.pending &&
                now - old.time >
                  (t.needsIdentity ? 1500 : old.failed ? 12000 : 3000) &&
                (t.needsIdentity ||
                  old.failed ||
                  difference(t.signature, old.signature) > 0.1)))
          );
        })
        .sort(
          (a, b) => Number(b.id === this.heldId) - Number(a.id === this.heldId),
        );
      if (candidates[0]) this.observe(candidates[0]);
    }
  }
  photo(box = [0, 0, 1, 1], max = 1600) {
    const v = this.video;
    const x = clamp(box[0], 0, 1),
      y = clamp(box[1], 0, 1);
    const w = Math.min(box[2], 1 - x),
      h = Math.min(box[3], 1 - y);
    const scale = Math.min(
      1,
      max / Math.max(v.videoWidth * w, v.videoHeight * h),
    );
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(v.videoWidth * w * scale));
    c.height = Math.max(1, Math.round(v.videoHeight * h * scale));
    c.getContext("2d").drawImage(
      v,
      x * v.videoWidth,
      y * v.videoHeight,
      w * v.videoWidth,
      h * v.videoHeight,
      0,
      0,
      c.width,
      c.height,
    );
    return c.toDataURL("image/jpeg", 0.9);
  }
  requestSignal(timeout) {
    const control = new AbortController();
    this.controllers.add(control);
    return {
      control,
      signal: AbortSignal.any([control.signal, AbortSignal.timeout(timeout)]),
    };
  }
  async detect(scene) {
    this.detecting = true;
    this.cb.status(
      this.tracks.length ? "Watching for new products" : "Finding products…",
    );
    const sequence = this.sequence,
      photo = this.photo(undefined, 960);
    const names = [...new Set(this.items.map((i) => i.item))];
    // Rotate long aisle lists instead of permanently excluding items after the first six.
    const offset = (this.promptOffset || 0) % names.length;
    const prompts = [...names.slice(offset), ...names.slice(0, offset)].slice(
      0,
      5,
    );
    this.promptOffset = offset + 5;
    if (
      this.items.some((i) =>
        /chips|oreo|snack|cracker|cookie|cheetos/i.test(i.item),
      )
    )
      prompts.push("food package");
    const { control, signal } = this.requestSignal(100000);
    try {
      const data = await this.api.detect(this.tripId, photo, prompts, signal);
      if (this.closed) return;
      this.trackWorker.postMessage({
        type: "detections",
        sequence,
        detections: data.detections,
      });
      this.lastScene = scene;
      this.lastDetected = performance.now();
      this.errors = 0;
      this.cb.error("");
      this.cb.status(
        data.detections.length
          ? "Live · turn a product to show its ingredients"
          : "Looking · move slowly and bring packaging into view",
      );
    } catch (e) {
      if (!this.closed && e.name !== "AbortError") this.networkError(e);
    } finally {
      this.controllers.delete(control);
      this.detecting = false;
      this.nextDetect =
        performance.now() + Math.min(60000, 8000 * 2 ** this.errors);
    }
  }
  networkError(e) {
    this.errors = Math.min(4, this.errors + 1);
    const expired = /expired|not found|complete/i.test(e.message);
    this.fail(
      e.message === "Not Found"
        ? "Restart the backend to load the live-camera update."
        : expired
          ? "Trip expired. Return to the list and start a new trip."
          : `${e.name === "TimeoutError" ? "AI request timed out" : e.message} · automatic retry`,
      expired,
    );
  }
  async observe(track) {
    this.reading = true;
    const old = this.readings.get(track.id);
    const image = this.photo(track.box);
    const front = old?.reference;
    const sequence = (this.readSequence = (this.readSequence || 0) + 1);
    const relevant = [...this.items]
      .sort(
        (a, b) =>
          Number(track.prompts.includes(b.item)) -
          Number(track.prompts.includes(a.item)),
      )
      .slice(0, 12);
    const ids = relevant.map((i) => i.id);
    this.readings.set(track.id, {
      ...old,
      pending: true,
      pendingSequence: sequence,
      time: performance.now(),
      signature: track.signature,
    });
    this.cb.status("Reading packaging automatically · keep the label visible");
    const { control, signal } = this.requestSignal(80000);
    try {
      const data = await this.api.observe(
        {
          trip_id: this.tripId,
          track_id: track.id,
          sequence,
          item_ids: ids,
          image_b64: image,
          reference_b64: front || null,
          evidence_b64: old?.evidence || null,
        },
        signal,
      );
      // Track lifetimes are never reused. A response for a lost object is discarded.
      if (
        this.closed ||
        !this.tracks.some(
          (t) => t.id === track.id && t.generation === track.generation,
        ) ||
        data.track_id !== track.id ||
        data.sequence !== sequence
      )
        return;
      const identityLost =
        (front || old?.evidence) && data.same_product !== "yes";
      this.readings.set(track.id, {
        data,
        pending: false,
        image,
        time: performance.now(),
        signature: track.signature,
        reference: identityLost ? null : data.view === "front" ? image : front,
        evidence: identityLost
          ? null
          : data.view === "ingredients"
            ? image
            : old?.evidence,
        failed: data.view === "unreadable" || !!identityLost,
      });
      if (!identityLost)
        this.trackWorker.postMessage({ type: "verified", id: track.id });
      this.cb.status(
        identityLost
          ? "Rechecking product identity · hold the front in view"
          : "Live · turn the packet to update its checks",
      );
      this.cb.error("");
      this.errors = 0;
    } catch (e) {
      if (!this.closed) {
        if (this.tracks.some((t) => t.id === track.id))
          this.readings.set(track.id, {
            ...old,
            pending: false,
            failed: true,
            time: performance.now(),
            signature: track.signature,
          });
        if (e.name !== "AbortError") this.networkError(e);
      }
    } finally {
      const pending = this.readings.get(track.id);
      if (pending?.pending && pending.pendingSequence === sequence)
        this.readings.set(track.id, {
          ...pending,
          pending: false,
          failed: true,
          time: performance.now(),
        });
      this.controllers.delete(control);
      this.reading = false;
      this.nextRead =
        performance.now() + Math.min(60000, 2000 * 2 ** this.errors);
      if (!this.closed) this.publish();
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controllers.forEach((c) => c.abort());
    this.controllers.clear();
    this.trackWorker.terminate();
    this.handWorker.terminate();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.video.srcObject = null;
  }
}
