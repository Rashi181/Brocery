import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { api } from "../api";
import BudgetBar from "../components/BudgetBar";
import ARScene from "../ar/ARScene";
import ScanCamera from "../components/ScanCamera";
import HandCamera from "../components/HandCamera";
import DecisionCard from "../components/DecisionCard";
import { cropImage, fileImage } from "../ar/images";

export default function ARScreen({ mode }) {
  const nav = useNavigate(),
    state = useStore(),
    overlay = useRef(null),
    xr = useRef(null),
    operation = useRef(0);
  const aisle = state.aisles.find((a) => a.aisle_no === state.currentAisleNo);
  const items =
    aisle?.items.filter(
      (i) => state.lines.find((l) => l.item_id === i.id)?.status === "pending",
    ) || [];
  const [selected, setSelected] = useState(null),
    [active, setActive] = useState(false),
    [scan, setScan] = useState(null),
    [preview, setPreview] = useState(false);
  const [camera, setCamera] = useState(false),
    [hand, setHand] = useState(false),
    [result, setResult] = useState(null),
    [image, setImage] = useState(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [highlight, setHighlight] = useState(null);
  const item = items.find((i) => i.id === selected) || items[0];
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  if (!state.tripId)
    return (
      <main className="page">
        <h1>Start with your household list</h1>
        <button onClick={() => nav("/")}>Import chat</button>
      </main>
    );
  async function detect(photo) {
    if (!items.length) return;
    const token = ++operation.current;
    setBusy("SAM is finding your list on this shelf…");
    setError("");
    setResult(null);
    try {
      const data = await api.detect(
        state.tripId,
        photo,
        [...new Set(items.map((i) => i.item))].slice(0, 6),
      );
      if (token !== operation.current) return;
      setScan({ ...data, image: photo });
      setPreview(true);
      xr.current?.place(data.detections, items);
      if (!data.detections.length)
        setNotice(
          "No candidates found. Move closer, use more light, or open the product camera.",
        );
    } catch (e) {
      if (token === operation.current) setError(e.message);
    } finally {
      if (token === operation.current) setBusy("");
    }
  }
  async function inspect(photo, request = item) {
    if (!request) return;
    const token = ++operation.current;
    setCamera(false);
    setSelected(request.id);
    setImage(photo);
    setResult(null);
    setBusy(`Muse is checking ${request.item} for ${request.requester}…`);
    setError("");
    try {
      const data = await api.analyze(
        state.tripId,
        request.id,
        photo,
        scan?.scan_id,
      );
      if (token === operation.current) setResult(data);
    } catch (e) {
      if (token === operation.current) setError(e.message);
    } finally {
      if (token === operation.current) setBusy("");
    }
  }
  async function pick(d) {
    if (busy || !scan) return;
    const request =
      items.find((i) => i.id === selected && i.item === d.prompt) ||
      items.find((i) => i.item === d.prompt);
    if (!request) {
      setNotice("Select a pending shopping request first.");
      return;
    }
    try {
      await inspect(await cropImage(scan.image, d.bbox), request);
    } catch (e) {
      setError(e.message);
    }
  }
  async function openCamera() {
    try {
      await xr.current?.end();
      setResult(null);
      setCamera(true);
    } catch (e) {
      setError(e.message);
    }
  }
  function done(message) {
    setResult(null);
    setPreview(false);
    setNotice(message + ` · $${useStore.getState().remaining.toFixed(2)} left`);
    if (
      !useStore
        .getState()
        .lines.some((l) => l.status === "pending" && l.requested === item?.item)
    )
      xr.current?.remove(item?.item);
    if (navigator.vibrate) navigator.vibrate(40);
  }
  async function upload(e) {
    try {
      const f = e.target.files?.[0];
      if (f) await detect(await fileImage(f));
    } catch (e) {
      setError(e.message);
    } finally {
      e.target.value = "";
    }
  }
  return (
    <div ref={overlay} className={`ar-root ${active ? "active" : ""}`}>
      <ARScene
        ref={xr}
        overlay={overlay}
        onCapture={detect}
        onPick={pick}
        onActive={setActive}
        onAnchored={() => setPreview(false)}
      />
      <header className="ar-top">
        {mode && <small className="notice">{mode}</small>}
        <div className="row justify-between">
          <button
            onClick={async () => {
              await xr.current?.end();
              nav("/aisles");
            }}
          >
            ← Route
          </button>
          <span className="eyebrow">
            AISLE {aisle?.aisle_no} / {aisle?.aisle}
          </span>
          <button
            onClick={async () => {
              await xr.current?.end();
              nav("/cart");
            }}
          >
            Basket
          </button>
        </div>
        <BudgetBar compact />
      </header>
      {!active &&
        !camera &&
        !hand &&
        !result &&
        !preview &&
        !busy &&
        !notice &&
        !error &&
        items.length > 0 && (
          <div className="camera-intro">
            <div className="viewfinder-symbol">⌖</div>
            <h1>Your list, on the shelf.</h1>
            <p>
              Scan the shelf to find candidates. Open the product camera for
              sharp labels and ingredient checks.
            </p>
            <small>
              AR labels stay with stationary shelf surfaces. Product checks use
              captured photos.
            </small>
          </div>
        )}
      <div className="ar-content">
        {!items.length && (
          <section className="panel">
            <div className="eyebrow">AISLE COMPLETE</div>
            <h2>That’s everything here.</h2>
            <p>Review the basket or head to your next aisle.</p>
          </section>
        )}
        {notice && (
          <p className="toast" role="status" onClick={() => setNotice("")}>
            {notice}
          </p>
        )}
        {error && (
          <p className="error panel" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <div className="panel progress" role="status">
            <span className="spinner" />
            {busy}
            <small>Keep the phone steady. You can keep looking around.</small>
          </div>
        )}
        {preview && scan && !result && !busy && (
          <section className="panel shelf-panel">
            <div className="row justify-between">
              <strong>{scan.detections.length} shelf candidates</strong>
              <button onClick={() => setPreview(false)}>Hide</button>
            </div>
            <div className="shelf-photo">
              <img src={scan.image} alt="Captured shelf" />
              {scan.detections.map((d) => (
                <button
                  aria-label={`Inspect ${d.prompt}`}
                  key={d.detection_id}
                  onClick={() => pick(d)}
                  className={`detection ${highlight === d.detection_id ? "highlight" : ""}`}
                  style={{
                    left: d.bbox[0] * 100 + "%",
                    top: d.bbox[1] * 100 + "%",
                    width: d.bbox[2] * 100 + "%",
                    height: d.bbox[3] * 100 + "%",
                  }}
                >
                  {d.mask && <img src={d.mask} alt="" />}
                  <span>{d.prompt}</span>
                </button>
              ))}
            </div>
            <small>
              Tap a candidate to check it. Detection alone does not verify a
              match.
            </small>
          </section>
        )}
        {result && item && (
          <DecisionCard
            key={result.analysis_id}
            item={item}
            result={result}
            image={image}
            onDone={done}
            onRetake={openCamera}
            onAlternative={(alt) => {
              setHighlight(alt.detection_id);
              setResult(null);
              setPreview(true);
            }}
          />
        )}
      </div>
      {!camera && (
        <footer className="ar-bottom">
          <div className="item-strip">
            {items.map((it) => (
              <button
                disabled={!!busy || !!result}
                key={it.id}
                className={it.id === item?.id ? "selected" : ""}
                onClick={() => {
                  setSelected(it.id);
                  setResult(null);
                }}
              >
                <strong>{it.item}</strong>
                <small>
                  {it.requester} · {it.rigidity}
                </small>
              </button>
            ))}
          </div>
          {!items.length ? (
            <button className="primary" onClick={() => nav("/cart")}>
              Aisle complete · review basket
            </button>
          ) : (
            <div className="row">
              <button
                className="primary grow"
                disabled={!!busy}
                onClick={() => (active ? xr.current?.capture() : openCamera())}
              >
                {active ? "Scan shelf" : "Product camera"}
              </button>
              {active && (
                <button disabled={!!busy} onClick={openCamera}>
                  Read label
                </button>
              )}
              <label className="button">
                Photo
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={!!busy}
                  onChange={upload}
                />
              </label>
              <button
                disabled={!!busy}
                onClick={async () => {
                  await xr.current?.end();
                  setResult(null);
                  setHand(true);
                }}
              >
                In hand
              </button>
              <button
                disabled={!!busy}
                onClick={async () => {
                  try {
                    await state.skipItem(item.id, "Not found on this shelf");
                    done(`Could not get ${item.item} for ${item.requester}`);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Not found
              </button>
              {scan && !preview && (
                <button onClick={() => setPreview(true)}>Shelf</button>
              )}
            </div>
          )}
        </footer>
      )}
      {hand && item && (
        <HandCamera
          item={item}
          scanId={scan?.scan_id}
          onClose={() => setHand(false)}
          onDecision={(checked, photo) => {
            setHand(false);
            setResult(checked);
            setImage(photo);
          }}
        />
      )}
      {camera && (
        <ScanCamera
          item={item}
          onClose={() => setCamera(false)}
          onCapture={inspect}
        />
      )}
    </div>
  );
}
