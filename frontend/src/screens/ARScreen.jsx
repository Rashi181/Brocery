import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import BudgetBar from "../components/BudgetBar";
import DecisionCard from "../components/DecisionCard";
import { LiveCamera } from "../ar/LiveCamera";

function initialChecks(item) {
  return [
    item.spec,
    ...(item.avoid || []).map((a) => `Avoid ${a}`),
    item.max_price != null
      ? `Under $${item.max_price.toFixed(2)} each`
      : "Price not yet read",
  ].filter(Boolean);
}

const createCamera = (...args) => new LiveCamera(...args);
export default function ARScreen({ mode, createEngine = createCamera }) {
  const nav = useNavigate(),
    state = useStore();
  const video = useRef(null),
    stage = useRef(null),
    view = useRef(null),
    engine = useRef(null),
    cards = useRef(new Map());
  const aisle = state.aisles.find((a) => a.aisle_no === state.currentAisleNo);
  const items = useMemo(
    () =>
      aisle?.items.filter(
        (i) =>
          state.lines.find((l) => l.item_id === i.id)?.status === "pending",
      ) || [],
    [aisle, state.lines],
  );
  const [tracks, setTracks] = useState([]),
    [status, setStatus] = useState("Opening live camera…");
  const [gesture, setGesture] = useState(""),
    [error, setError] = useState(""),
    [pointer, setPointer] = useState(null);
  const [aspect, setAspect] = useState(9 / 16),
    [size, setSize] = useState({ width: 0, height: 0 });
  const [decision, setDecision] = useState(null),
    [notice, setNotice] = useState("");
  const focusId = tracks
    .filter((t) => t.scale > 1.22)
    .sort((a, b) => b.scale - a.scale)[0]?.id;
  const tripId = state.tripId;
  useEffect(() => {
    if (!tripId || !video.current) return;
    const live = createEngine(video.current, tripId, {
      tracks: setTracks,
      status: setStatus,
      gesture: setGesture,
      error: setError,
      pointer: setPointer,
      ready: setAspect,
      scroll: (id, delta) =>
        cards.current.get(id)?.scrollBy({ top: delta, behavior: "instant" }),
      cards: () => {
        const bounds = view.current?.getBoundingClientRect();
        if (!bounds?.width) return [];
        return [...cards.current.entries()].flatMap(([id, el]) => {
          if (!el) return [];
          const r = el.getBoundingClientRect();
          return [
            {
              id,
              scale: live.scales.get(id) || 1,
              box: [
                (r.left - bounds.left) / bounds.width,
                (r.top - bounds.top) / bounds.height,
                r.width / bounds.width,
                r.height / bounds.height,
              ],
            },
          ];
        });
      },
    });
    engine.current = live;
    live.start();
    return () => {
      live.close();
      engine.current = null;
    };
  }, [tripId, state.currentAisleNo, createEngine]);
  useEffect(() => {
    engine.current?.setItems(items);
  }, [items]);
  useEffect(() => {
    engine.current?.setPaused(!!decision);
  }, [decision]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.min(width, height * aspect);
      setSize({ width: w, height: w / aspect });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [aspect]);
  if (!tripId)
    return (
      <main className="page">
        <h1>Start with your shopping list</h1>
        <button onClick={() => nav("/")}>Import chat</button>
      </main>
    );
  return (
    <main className="live-root">
      <header className="live-header">
        {mode && <small className="notice">{mode}</small>}
        <div className="row justify-between">
          <button onClick={() => nav("/aisles")}>← Aisles</button>
          <span className="eyebrow">{aisle?.aisle} · LIVE</span>
          <button onClick={() => nav("/cart")}>Basket</button>
        </div>
        <BudgetBar compact />
      </header>
      <div ref={stage} className="live-stage">
        <div
          ref={view}
          className="live-view"
          style={size.width ? size : { width: "100%", height: "100%" }}
        >
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            aria-label="Live rear camera"
          />
          {tracks.map((track, index) => {
            const reading = track.reading;
            const data =
              track.needsIdentity || track.lost ? null : reading?.data;
            const box = track.visualBox || track.box;
            const assessments =
              data?.assessments.filter((a) =>
                items.some((i) => i.id === a.item_id),
              ) || [];
            const matches = assessments.filter((a) => a.identity === "pass");
            const pending = items.filter((i) => track.prompts.includes(i.item));
            const shown = matches.length
              ? matches
              : assessments.filter((a) => a.identity !== "fail");
            const expanded = track.scale > 1.22;
            const compact = !!focusId && focusId !== track.id;
            const title =
              data?.product_name ||
              (track.lost
                ? "Reacquiring…"
                : reading?.pending
                  ? "Reading packet…"
                  : "Product candidate");
            const lane = track.slot ?? index % 2;
            const baseWidth = Math.min(210, (size.width - 24) / 2);
            const cardWidth = Math.max(
              100,
              Math.min(
                size.width - 16,
                (expanded ? 210 : baseWidth) * track.scale,
              ),
            );
            const left = expanded
              ? Math.max(8, (size.width - cardWidth) / 2)
              : lane % 2 === 0
                ? 8
                : Math.max(8, size.width - cardWidth - 8);
            const top = expanded
              ? 8
              : compact
                ? Math.max(8, size.height - 85)
                : 8;
            return (
              <div key={track.id}>
                <svg
                  className="live-leader"
                  width="100%"
                  height="100%"
                  aria-hidden="true"
                >
                  <line
                    x1={(box[0] + box[2] / 2) * size.width}
                    y1={(box[1] + box[3] / 2) * size.height}
                    x2={left + cardWidth / 2}
                    y2={top + 40}
                    stroke="currentColor"
                    strokeWidth="1"
                  />
                </svg>
                <div
                  className={`live-object ${track.held ? "held" : ""}`}
                  style={{
                    left: box[0] * 100 + "%",
                    top: box[1] * 100 + "%",
                    width: box[2] * 100 + "%",
                    height: box[3] * 100 + "%",
                    opacity: track.lost ? 0.2 : 1,
                  }}
                />
                <article
                  ref={(el) => {
                    if (el) cards.current.set(track.id, el);
                    else cards.current.delete(track.id);
                  }}
                  className={`live-card ${track.resizing ? "resizing" : ""}`}
                  style={{
                    left,
                    top,
                    width: cardWidth,
                    fontSize: `${12 * track.scale}px`,
                    zIndex: track.resizing ? 20 : index + 2,
                    maxHeight: expanded
                      ? "78%"
                      : compact
                        ? "80px"
                        : data
                          ? "42%"
                          : "112px",
                    opacity: track.lost ? 0.4 : 1,
                  }}
                  aria-label={`${title} live details`}
                >
                  <div className="live-card-top">
                    <span>{track.held ? "IN HAND" : "LIVE CHECK"}</span>
                    <span>
                      {track.resizing
                        ? "↔ RESIZING"
                        : reading?.pending
                          ? "READING…"
                          : "◉"}
                    </span>
                  </div>
                  <strong className="live-product-name">{title}</strong>
                  {track.needsIdentity && (
                    <p>Checking identity after movement…</p>
                  )}
                  {!matches.length && (
                    <small>
                      {data
                        ? "Request match not yet verified"
                        : reading?.pending
                          ? "Checking your list…"
                          : "Waiting for a steady view"}
                    </small>
                  )}
                  {!compact &&
                    shown.map((a) => {
                      const item = items.find((i) => i.id === a.item_id);
                      return (
                        <section key={a.item_id} className="live-request">
                          <b>
                            {a.identity === "pass" ? "For" : "Checking for"}{" "}
                            {item.shared ? "the household" : item.requester}
                          </b>
                          <small>
                            {item.item} · {item.quantity}
                          </small>
                          <small>
                            {a.result.price == null
                              ? "Price not yet visible"
                              : `Visible price $${a.result.price.toFixed(2)}`}
                          </small>
                          <ul>
                            {a.result.checklist
                              .slice(0, expanded ? 100 : 2)
                              .map((c, i) => (
                                <li key={i} className={c.status}>
                                  <span>
                                    {c.status === "pass"
                                      ? "✓"
                                      : c.status === "fail"
                                        ? "✕"
                                        : "?"}
                                  </span>
                                  {c.text}
                                </li>
                              ))}
                          </ul>
                          {!expanded && a.result.checklist.length > 3 && (
                            <small>
                              Spread fingers to see all{" "}
                              {a.result.checklist.length} checks
                            </small>
                          )}
                          <button
                            onClick={() =>
                              setDecision({
                                item,
                                result: a.result,
                                image: reading.image,
                              })
                            }
                          >
                            Add / decide
                          </button>
                        </section>
                      );
                    })}
                  {expanded &&
                    !compact &&
                    !data &&
                    pending.map((i) => (
                      <section className="live-request" key={i.id}>
                        <b>Checking for {i.requester}</b>
                        <small>{i.item}</small>
                        <ul>
                          {initialChecks(i)
                            .slice(0, expanded ? 100 : 3)
                            .map((c, j) => (
                              <li className="warn" key={j}>
                                <span>?</span>
                                {c}
                              </li>
                            ))}
                        </ul>
                      </section>
                    ))}
                  {compact && (
                    <small>
                      {matches
                        .map(
                          (a) =>
                            items.find((i) => i.id === a.item_id)?.requester,
                        )
                        .join(" · ") || "Checking…"}
                    </small>
                  )}
                  {data && !shown.length && (
                    <p>This product does not match the aisle requests.</p>
                  )}
                  {expanded && data && (
                    <section className="live-evidence">
                      <b>Visible packaging text</b>
                      <p>
                        {data.visible_text ||
                          "Not readable yet. Turn the label toward the camera."}
                      </p>
                      <small>Unreadable text stays unverified.</small>
                    </section>
                  )}
                  {(data || expanded) && (
                    <small className="live-pinch-hint">
                      Pinch here in the air · spread to enlarge
                    </small>
                  )}
                </article>
              </div>
            );
          })}
          {pointer && (
            <div
              className={`live-pointer ${pointer.locked ? "locked" : ""}`}
              style={{
                left: pointer.x * 100 + "%",
                top: pointer.y * 100 + "%",
              }}
            />
          )}
        </div>
      </div>
      <footer className="live-footer">
        {notice && <p role="status">{notice}</p>}
        <p role="status">
          <span className="live-dot" />
          {items.length
            ? status
            : "Aisle complete · open your basket or the next aisle"}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <small>{gesture}</small>
        {!tracks.length && items.length > 0 && (
          <small>
            Point at the products. Hold packaging steady briefly for sharp text.
          </small>
        )}
      </footer>
      {decision && (
        <div
          className="live-decision"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm basket item"
        >
          <button className="live-close" onClick={() => setDecision(null)}>
            ← Back to live camera
          </button>
          <DecisionCard
            key={decision.result.analysis_id}
            {...decision}
            live
            onDone={(message) => {
              setDecision(null);
              setNotice(message);
            }}
            onRetake={() => setDecision(null)}
          />
        </div>
      )}
    </main>
  );
}
