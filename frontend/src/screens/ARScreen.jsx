import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import BudgetBar from "../components/BudgetBar";
import DecisionCard from "../components/DecisionCard";
import { LiveCamera } from "../ar/LiveCamera";
import { productCard } from "../ar/productCard";

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
            const identity = track.identity;
            const recognised = identity?.data;
            const data =
              track.needsIdentity || track.lost ? null : reading?.data;
            const box = track.visualBox || track.box;
            const card = productCard(recognised, data, items);
            const shown = card.shown;
            const matches = shown;
            const expanded = track.scale > 1.22;
            const compact = !!focusId && focusId !== track.id;
            const title =
              (track.lost
                ? "Reacquiring…"
                : card.title);
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
                        : shown.length
                          ? "42%"
                          : "112px",
                    opacity: track.lost ? 0.4 : 1,
                  }}
                  aria-label={`${title} live details`}
                >
                  <div className="live-card-top">
                    <span>{track.held ? "IN HAND" : (recognised ? "PRODUCT IDENTIFIED" : "FINDING PRODUCT")}</span>
                    <span>
                      {track.resizing
                        ? "↔ RESIZING"
                        : reading?.pending
                          ? "TEXT…"
                          : "◉"}
                    </span>
                  </div>
                  <strong className="live-product-name">{title}</strong>
                  {recognised && <small>{recognised.category}</small>}
                  {identity?.pending && <small>Identifying product…</small>}
                  {identity?.message && <small role="status">{identity.message}</small>}
                  {track.needsIdentity && (
                    <small>Previous ingredient checks cleared after movement.</small>
                  )}
                  {recognised && shown.length > 0 && (
                    <small>
                      {data
                        ? "Request match not yet verified"
                        : reading?.pending
                          ? "Reading visible text in background"
                          : "Show ingredients to check requirements"}
                    </small>
                  )}
                  {!compact &&
                    shown.map((a) => {
                      const item = items.find((i) => i.id === a.item_id);
                      return (
                        <section key={a.item_id} className="live-request">
                          <b>
                            For{" "}
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
                                  image: reading?.image || engine.current?.photo(track.box),
                              })
                            }
                          >
                            Add to cart
                          </button>
                        </section>
                      );
                    })}
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
                  {card.outside && (
                    <p>Not on your list for this aisle.</p>
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
