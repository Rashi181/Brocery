import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { fitCapture } from "../ar/scanCameraMath";
import {
  grayscale,
  seedTrack,
  moveTrack,
  centerCandidate,
} from "../ar/localTracker";
import { cropImage } from "../ar/images";

export default function HandCamera({ item, scanId, onClose, onDecision }) {
  const video = useRef(null),
    tracking = useRef(null),
    stream = useRef(null),
    cancelled = useRef(false);
  const [ready, setReady] = useState(false),
    [status, setStatus] = useState("Opening camera…"),
    [box, setBox] = useState(null),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [photo, setPhoto] = useState(null);
  const tripId = useStore((s) => s.tripId);
  useEffect(() => {
    let owned = null,
      timer = null,
      disposed = false;
    cancelled.current = false;
    const preview = video.current,
      canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    async function start() {
      try {
        owned = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (disposed) {
          owned.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = owned;
        preview.srcObject = owned;
        await preview.play();
        const track = owned.getVideoTracks()[0];
        if (track.getCapabilities?.().focusMode?.includes("continuous"))
          await track
            .applyConstraints({ advanced: [{ focusMode: "continuous" }] })
            .catch(() => {});
        if (disposed) return;
        setReady(true);
        setStatus(
          "Hold one product in the center, then find it. Only a photo is sent.",
        );
        timer = setInterval(() => {
          if (!tracking.current || preview.readyState < 2) return;
          ctx.drawImage(preview, 0, 0, 160, 160);
          const next = moveTrack(
            tracking.current,
            grayscale(ctx.getImageData(0, 0, 160, 160).data),
            160,
            160,
          );
          tracking.current = next;
          if (next) setBox(next.box);
          else {
            setBox(null);
            setStatus(
              "Tracking lost. Hold still and tap Find held product again.",
            );
          }
        }, 125);
      } catch (e) {
        if (!cancelled.current) setStatus(e.message);
      }
    }
    start();
    return () => {
      disposed = true;
      cancelled.current = true;
      clearInterval(timer);
      owned?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      tracking.current = null;
      preview.srcObject = null;
    };
  }, []);
  async function find() {
    if (!ready || busy) return;
    setBusy(true);
    setResult(null);
    tracking.current = null;
    setBox(null);
    try {
      const target = video.current,
        size = fitCapture(target.videoWidth, target.videoHeight),
        canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d").drawImage(target, 0, 0, size.width, size.height);
      const image = canvas.toDataURL("image/jpeg", 0.93);
      setStatus("SAM is locating the centered product. Hold still…");
      const scan = await api.detect(tripId, image, [item.item]);
      if (cancelled.current) return;
      const d = centerCandidate(scan.detections);
      if (!d)
        throw new Error(
          "No centered product found. Show the front and try again.",
        );
      // Seed from the exact detection photo, not the later camera frame.
      const seedCanvas = document.createElement("canvas");
      seedCanvas.width = 160;
      seedCanvas.height = 160;
      const context = seedCanvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, 160, 160);
      tracking.current = seedTrack(
        grayscale(context.getImageData(0, 0, 160, 160).data),
        160,
        160,
        d.bbox,
      );
      setBox(tracking.current ? d.bbox : null);
      const crop = await cropImage(image, d.bbox);
      setPhoto(crop);
      setStatus(
        "Muse is checking this product. Keep its label facing the camera…",
      );
      const checked = await api.analyze(tripId, item.id, crop, scanId);
      if (cancelled.current) return;
      setResult(checked);
      setStatus(
        "Check complete. Moving box uses local motion tracking; the check applies to the captured product.",
      );
    } catch (e) {
      if (!cancelled.current) setStatus(e.message);
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  }
  return (
    <section
      className="scan-camera hand-camera"
      role="dialog"
      aria-label="In-hand inspection"
    >
      <header className="scan-header">
        <strong>IN YOUR HAND · {item.item}</strong>
        <button onClick={onClose}>Back</button>
      </header>
      <div className="hand-preview">
        <video ref={video} autoPlay muted playsInline />
        {box && (
          <div
            className="tracked-box"
            style={{
              left: box[0] * 100 + "%",
              top: box[1] * 100 + "%",
              width: box[2] * 100 + "%",
              height: box[3] * 100 + "%",
            }}
          >
            <span>
              {item.requester} · {item.item}
            </span>
            {result && (
              <div
                className="tracked-checks"
                onDoubleClick={() => onDecision(result, photo)}
              >
                {result.checklist.slice(0, 3).map((c, i) => (
                  <small className={c.status} key={i}>
                    {c.status === "pass"
                      ? "✓"
                      : c.status === "fail"
                        ? "×"
                        : "?"}{" "}
                    {c.text}
                  </small>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <p role="status" className="capture-status">
        {status}
      </p>
      <button className="primary" disabled={!ready || busy} onClick={find}>
        {busy ? "Checking…" : "Find held product"}
      </button>
      {result && (
        <button onClick={() => onDecision(result, photo)}>
          Open full checklist & decide →
        </button>
      )}
      <small className="muted">
        If text is too small, return and use Read label for a close photo.
      </small>
    </section>
  );
}
