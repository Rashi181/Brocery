import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import BudgetBar from "../components/BudgetBar";

const STATUS_MARK = {
  purchased: { mark: "✓", cls: "flexible" },
  substituted: { mark: "↻", cls: "preferred" },
  skipped: { mark: "✗", cls: "strict" },
};

export default function AislesScreen() {
  const nav = useNavigate();
  const { aisles, lines, tripId, setCurrentAisle } = useStore();

  if (!tripId) {
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: 120 }}>
        <button onClick={() => nav("/")}>No trip started. Go back.</button>
      </div>
    );
  }

  const statusOf = (itemId) =>
    lines.find((l) => l.item_id === itemId)?.status || "pending";

  const remainingCount = lines.filter((l) => l.status === "pending").length;

  return (
    <div className="page" style={{ paddingBottom: 110 }}>
      <BudgetBar />
      <p className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
        Demo store layout · aisle numbers are sample data
      </p>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 22, marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>
          Your aisle
          <span className="h1-accent">route</span>
        </h1>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {remainingCount} left
        </span>
      </div>

      <div className="stack" style={{ gap: 18 }}>
        {aisles.map((a) => {
          const done = a.items.every((it) => statusOf(it.id) !== "pending");
          return (
            <div key={a.aisle_no}>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="badge">{a.aisle_no}</span>
                <span
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: done ? "var(--ink-dim)" : "var(--ink)",
                    textDecoration: done ? "line-through" : "none",
                  }}
                >
                  {a.aisle}
                </span>
              </div>

              <div className="panel" style={{ padding: 0 }}>
                {a.items.map((it, i) => {
                  const st = statusOf(it.id);
                  const m = STATUS_MARK[st];
                  return (
                    <div
                      key={it.id}
                      className="row"
                      style={{
                        justifyContent: "space-between",
                        padding: "12px 16px",
                        borderTop: i > 0 ? "1px solid rgba(0,0,0,0.08)" : "none",
                      }}
                    >
                      <div className="grow">
                        <div
                          style={{
                            fontSize: "0.9rem",
                            color: st !== "pending" ? "var(--ink-dim)" : "var(--ink)",
                          }}
                        >
                          {it.item}
                        </div>
                        <small className="muted">
                          {it.requester || "shared"}
                          {it.spec ? ` · ${it.spec}` : ""}
                        </small>
                      </div>
                      {m && <span className={`badge ${m.cls}`}>{m.mark}</span>}
                    </div>
                  );
                })}
              </div>

              {!done && (
                <button
                  onClick={() => {
                    setCurrentAisle(a.aisle_no);
                    nav("/ar");
                  }}
                  style={{ width: "100%", marginTop: 8 }}
                >
                  Scan aisle {a.aisle_no}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="dock">
        <button onClick={() => nav("/cart")} className="primary cta block">
          Review basket
        </button>
      </div>
    </div>
  );
}
