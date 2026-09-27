import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { api } from "../api";
import BudgetBar from "../components/BudgetBar";

export default function CartScreen() {
  const nav = useNavigate(),
    { tripId, lines, applyCart, refreshCart, aisles, setCurrentAisle } =
      useStore();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tripId) refreshCart().catch((e) => setError(e.message));
  }, [tripId, refreshCart]);
  async function undo(id) {
    setBusy(true);
    try {
      applyCart(await api.undo(tripId, id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!tripId)
    return (
      <main className="page">
        <h1>No basket yet</h1>
        <button onClick={() => nav("/")}>Import chat</button>
      </main>
    );
  return (
    <main className="page pb-32">
      <button onClick={() => nav("/aisles")}>← Your route</button>
      <p className="eyebrow" style={{ marginTop: 22 }}>
        The basket
      </p>
      <h1>
        Every bro
        <span className="h1-accent">accounted for.</span>
      </h1>
      <BudgetBar />
      <div className="stack mt-6">
        {lines.map((l) => (
          <article className="panel" key={l.item_id}>
            <div className="item-head">
              <strong>{l.product_name || l.requested}</strong>
              <span className={`badge ${l.status}`}>{l.status}</span>
            </div>
            <p className="muted">
              {l.quantity} × {l.requested} ·{" "}
              {l.shared ? "Shared household item" : l.requester}
            </p>
            {l.price != null && <h2>${l.price.toFixed(2)}</h2>}
            {l.price_source && <small className="muted">{l.price_source} · not a store price</small>}
            {l.reason && <p className="quote">{l.reason}</p>}
            {l.status !== "pending" ? (
              <button disabled={busy} onClick={() => undo(l.item_id)}>
                Undo / shop again
              </button>
            ) : (
              <button
                onClick={() => {
                  setCurrentAisle(
                    aisles.find((a) => a.items.some((i) => i.id === l.item_id))
                      ?.aisle_no,
                  );
                  nav("/ar");
                }}
              >
                Find this item
              </button>
            )}
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer className="dock">
        <button
          className="primary cta block"
          onClick={() => nav("/checkout")}
        >
          Check out, bro →
        </button>
        <small className="muted">
          Shopping summary only. No payment is collected.
        </small>
      </footer>
    </main>
  );
}
