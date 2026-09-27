import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";

export default function ReviewScreen() {
  const nav = useNavigate();
  const {
    items,
    unresolved = [],
    updateItem,
    removeItem,
    startTrip,
    loading,
    error,
  } = useStore();
  const [budget, setBudget] = useState("60");
  const [open, setOpen] = useState(null);
  const [runner, setRunner] = useState("");
  const [reviewed, setReviewed] = useState(false);
  if (!items.length)
    return (
      <main className="page">
        <h1>No list yet</h1>
        <button onClick={() => nav("/")}>Import a chat</button>
      </main>
    );
  async function start() {
    try {
      await startTrip(Number(budget), runner);
      nav("/aisles");
    } catch {
      /* store displays error */
    }
  }
  return (
    <main className="page pb-64">
      <p className="eyebrow">Review the requests</p>
      <h1>
        {items.length} things.
        <span className="h1-accent">One good run.</span>
      </h1>
      <p className="muted">
        Check what everyone meant before heading into the aisle. All amounts are
        USD.
      </p>
      {!!unresolved.length && (
        <aside className="notice">
          Needs a decision: {unresolved.join(" · ")}
        </aside>
      )}
      <div className="stack">
        {items.map((it) => (
          <article className="panel" key={it.id}>
            <button
              className="item-head"
              onClick={() => setOpen(open === it.id ? null : it.id)}
            >
              <span>
                <strong>
                  {it.quantity} × {it.item}
                </strong>
                <small>
                  {it.shared ? "Shared household item" : `For ${it.requester}`}
                </small>
              </span>
              <span className={`badge ${it.rigidity}`}>{it.rigidity}</span>
            </button>
            <p>{it.spec || "No additional specifications"}</p>
            {!!it.avoid?.length && (
              <p className="badge preferred" style={{ display: "inline-block" }}>
                Avoid: {it.avoid.join(", ")}
              </p>
            )}
            <small className="muted">
              {it.max_price == null
                ? "No price limit specified"
                : `Up to $${it.max_price.toFixed(2)} per unit`}
            </small>
            {it.reason && <p className="quote">“{it.reason}”</p>}
            {it.needs_review && <p className="notice">{it.review_note}</p>}
            {open === it.id && (
              <div className="stack mt-4">
                {[
                  "item",
                  "requester",
                  "quantity",
                  "spec",
                  "reason",
                  "substitute_rule",
                ].map((key) => (
                  <label key={key}>
                    {
                      {
                        item: "Product",
                        requester: "Requested by",
                        quantity: "Quantity",
                        spec: "Requirements (separate with ;)",
                        reason: "Why it matters",
                        substitute_rule: "Allowed replacements",
                      }[key]
                    }
                    <input
                      value={it[key] || ""}
                      onChange={(e) =>
                        updateItem(it.id, { [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Avoid (separate with ;)
                  <input
                    value={it.avoid.join("; ")}
                    onChange={(e) =>
                      updateItem(it.id, {
                        avoid: e.target.value
                          .split(";")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <label>
                  Maximum unit price (USD)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.max_price ?? ""}
                    onChange={(e) =>
                      updateItem(it.id, {
                        max_price:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Flexibility
                  <select
                    value={it.rigidity}
                    onChange={(e) =>
                      updateItem(it.id, { rigidity: e.target.value })
                    }
                  >
                    {["strict", "preferred", "flexible"].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={it.shared}
                    onChange={(e) =>
                      updateItem(it.id, { shared: e.target.checked })
                    }
                  />
                  Split this item among the household
                </label>
                <details>
                  <summary>Source messages</summary>
                  {it.evidence.map((e, i) => (
                    <p className="quote" key={i}>
                      {e}
                    </p>
                  ))}
                </details>
                <button className="danger" onClick={() => removeItem(it.id)}>
                  Remove request
                </button>
              </div>
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
        <label>
          Who is doing this run?
          <input
            placeholder="Your name for the leaderboard"
            value={runner}
            onChange={(e) => setRunner(e.target.value)}
            maxLength={80}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed requests, quantities and unresolved messages
        </label>
        <div className="row">
          <label className="budget-input">
            Budget $
            <input
              aria-label="Trip budget"
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <button
            className="primary grow cta"
            disabled={
              loading ||
              !reviewed ||
              !runner.trim() ||
              budget === "" ||
              Number(budget) < 0
            }
            onClick={start}
          >
            {loading ? "Preparing your route…" : "Start shopping"}
          </button>
        </div>
      </footer>
    </main>
  );
}
