import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import BudgetBar from "../components/BudgetBar";

const STATUS_MARK = {
  purchased: { mark: "✓", cls: "text-emerald-400" },
  substituted: { mark: "↻", cls: "text-amber-400" },
  skipped: { mark: "✗", cls: "text-red-400" },
};

export default function AislesScreen() {
  const nav = useNavigate();
  const { aisles, lines, tripId, setCurrentAisle } = useStore();

  if (!tripId) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-white grid place-items-center">
        <button onClick={() => nav("/")} className="underline text-sm">
          No trip started. Go back.
        </button>
      </div>
    );
  }

  const statusOf = (itemId) =>
    lines.find((l) => l.item_id === itemId)?.status || "pending";

  const remainingCount = lines.filter((l) => l.status === "pending").length;

  return (
    <div className="min-h-dvh bg-neutral-950 text-white px-5 py-6 pb-28">
      <div className="max-w-xl mx-auto">
        <BudgetBar />

        <div className="flex items-baseline justify-between mt-6 mb-4">
          <h1 className="text-xl font-semibold">Your route</h1>
          <span className="text-sm text-white/40">{remainingCount} left</span>
        </div>

        <div className="space-y-4">
          {aisles.map((a) => {
            const done = a.items.every((it) => statusOf(it.id) !== "pending");
            return (
              <div key={a.aisle_no}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-md bg-white/10 grid
                                   place-items-center text-xs tabular-nums">
                    {a.aisle_no}
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      done ? "text-white/30 line-through" : ""
                    }`}
                  >
                    {a.aisle}
                  </span>
                </div>

                <div className="bg-neutral-900 border border-white/10
                                rounded-xl divide-y divide-white/5">
                  {a.items.map((it) => {
                    const st = statusOf(it.id);
                    const m = STATUS_MARK[st];
                    return (
                      <div
                        key={it.id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div
                            className={`text-sm ${
                              st !== "pending" ? "text-white/35" : ""
                            }`}
                          >
                            {it.item}
                          </div>
                          <div className="text-xs text-white/35 truncate">
                            {it.requester || "shared"}
                            {it.spec ? ` · ${it.spec}` : ""}
                          </div>
                        </div>
                        {m && <span className={m.cls}>{m.mark}</span>}
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
                    className="w-full mt-2 py-2.5 rounded-xl bg-white/10
                               hover:bg-white/15 text-sm font-medium"
                  >
                    Scan aisle {a.aisle_no}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-neutral-950/95 backdrop-blur
                      border-t border-white/10 px-5 py-4">
        <div className="max-w-xl mx-auto">
          <button
            onClick={() => nav("/cart")}
            className="w-full py-3 rounded-xl bg-white text-black font-medium"
          >
            {remainingCount === 0 ? "Check out" : "Skip to checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}