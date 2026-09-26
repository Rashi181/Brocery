import { useEffect, useRef, useState } from "react";
import { fitCapture, focusPoint } from "../ar/scanCameraMath.js";

export default function ScanCamera({ item, onClose, onCapture }) {
  const video = useRef(null);
  const stream = useRef(null);
  const focusing = useRef(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Opening rear camera…");
  const [tapEnabled, setTapEnabled] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [point, setPoint] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let ownedStream = null;
    const preview = video.current;
    async function start() {
      setReady(false);
      setTapEnabled(false);
      setStatus("Opening rear camera…");
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera requires HTTPS and a supported browser.");
        ownedStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          ownedStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = ownedStream;
        const track = ownedStream.getVideoTracks()[0];
        track.onended = () => {
          if (!cancelled) {
            setReady(false);
            setStatus("Camera stopped. Tap Retry camera.");
          }
        };
        preview.srcObject = ownedStream;
        await preview.play();
        if (cancelled) return;
        const modes = track.getCapabilities?.().focusMode ?? [];
        let focusStatus =
          "Focus is managed by your phone; browser focus controls are unavailable.";
        if (modes.includes("continuous")) {
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: "continuous" }],
            });
            focusStatus =
              track.getSettings().focusMode === "continuous"
                ? "Continuous autofocus enabled."
                : "Autofocus requested; browser did not confirm it.";
          } catch {
            focusStatus =
              "Could not enable autofocus; using the camera default.";
          }
        }
        if (cancelled) return;
        // Global support alone is insufficient: check this camera exposes focus points.
        const settings = track.getSettings();
        const canTap =
          !!navigator.mediaDevices.getSupportedConstraints().pointsOfInterest &&
          "pointsOfInterest" in settings &&
          modes.some((mode) => ["single-shot", "continuous"].includes(mode));
        setTapEnabled(canTap);
        setStatus(
          focusStatus +
            (canTap
              ? " Tap the label to request focus."
              : " Tap-to-focus is not exposed by this camera/browser."),
        );
        setReady(true);
      } catch (error) {
        ownedStream?.getTracks().forEach((track) => track.stop());
        if (!cancelled)
          setStatus(
            error.name === "NotAllowedError"
              ? "Allow camera access in your browser, then retry."
              : error.message,
          );
      }
    }
    start();
    return () => {
      cancelled = true;
      ownedStream?.getTracks().forEach((track) => track.stop());
      if (stream.current === ownedStream) stream.current = null;
      preview.srcObject = null;
    };
  }, [attempt]);

  async function focus(event) {
    if (!ready || !tapEnabled || photo || focusing.current) return;
    const target = video.current;
    const rect = target.getBoundingClientRect();
    const position = focusPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      target.videoWidth,
      target.videoHeight,
    );
    if (!position) return;
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    focusing.current = true;
    try {
      const modes = track.getCapabilities().focusMode ?? [];
      await track.applyConstraints({
        advanced: [
          {
            focusMode: modes.includes("single-shot")
              ? "single-shot"
              : "continuous",
            pointsOfInterest: [position],
          },
        ],
      });
      if (stream.current?.getVideoTracks()[0] !== track) return;
      const applied = track.getSettings().pointsOfInterest;
      if (
        !applied?.some(
          (p) =>
            Math.abs(p.x - position.x) < 0.02 &&
            Math.abs(p.y - position.y) < 0.02,
        )
      ) {
        setTapEnabled(false);
        setStatus(
          "The browser did not confirm the focus point. Use automatic focus and adjust your distance.",
        );
        return;
      }
      setPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      setStatus(
        "Focus point set. Wait until the text looks sharp, then capture.",
      );
    } catch {
      setStatus(
        "Focus request failed. Move slightly farther back and wait for autofocus.",
      );
    } finally {
      focusing.current = false;
    }
  }

  function capture() {
    try {
      const target = video.current;
      if (!ready || target.readyState < 2)
        throw new Error("Wait for the camera preview.");
      const size = fitCapture(target.videoWidth, target.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d").drawImage(target, 0, 0, size.width, size.height);
      setPhoto(canvas.toDataURL("image/jpeg", 0.93));
      setStatus(
        "Captured " +
          size.width +
          " × " +
          size.height +
          ". Check text sharpness before reading.",
      );
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section
      className="scan-camera"
      role="dialog"
      aria-modal="true"
      aria-label="Label scanner"
    >
      <header className="scan-header">
        <strong>PRODUCT CAMERA</strong>
        <button className="capture-button" onClick={onClose}>
          BACK
        </button>
      </header>
      <p className="capture-status">
        {item ? "Shopping for: " + item.item : "Point at one product label."}{" "}
        Hold steady in good light; move back if the text is blurry.
      </p>
      <div className="scan-preview" hidden={!!photo}>
        <video ref={video} autoPlay muted playsInline onClick={focus} />
        {point && (
          <span
            className="focus-ring"
            style={{ left: point.x, top: point.y }}
          />
        )}
      </div>
      {photo && (
        <img
          className="scan-photo"
          src={photo}
          alt="Captured label; check whether the text is sharp"
        />
      )}
      <p className="capture-status" role="status">
        {status}
      </p>
      {!photo && (
        <button className="capture-button" disabled={!ready} onClick={capture}>
          CAPTURE LABEL
        </button>
      )}
      {!ready && (
        <button
          className="capture-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          RETRY CAMERA
        </button>
      )}
      {photo && (
        <>
          <button
            className="capture-button"
            onClick={() => {
              setPhoto(null);
              setPoint(null);
              setStatus("Hold steady and wait for sharp text, then capture.");
            }}
          >
            RETAKE PHOTO
          </button>
          <button className="primary" onClick={() => onCapture(photo)}>
            CHECK THIS PRODUCT
          </button>
        </>
      )}
      <p className="capture-status">
        Back releases the camera. Restart AR and scan the shelf to place labels
        again.
      </p>
    </section>
  );
}
