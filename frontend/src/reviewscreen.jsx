import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";

const RIGIDITY = ["strict", "preferred", "flexible"];

const RIGIDITY_STYLE = {
  strict: "bg-red-500/15 text-red-300 border-red-500/30",
  preferred: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  flexible: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export default function ReviewScreen() {
  const nav = useNavigate();
  const { items, updateItem, removeItem, startTrip, loading, error } =
    useStore();
  const [budget, setBudget] = useState(60);
  const [openId, setOpenId] = useState(null);

  if (!items.length) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-white grid place-items-center">
        <button onClick={() => nav("/")} className="underline text-sm">
          No list yet. Import a chat.
        </button>
      </div>
    );
  }

  async function go() {
    await startTrip(Number(budget));
    nav("/aisles");
  }

  return (
    <div className="min-h-dvh bg-neutral-950 text-white px-5 py-8 pb-32">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">
          {items.length} things to get
        </h1>
        <p className="text-sm text-white/50 mb-6">
          Tap anything that looks wrong. This is the last time you have to
          do admin.
        </p>

        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="bg-neutral-900 border border-white/10 rounded-xl
                         overflow-hidden"
            >
              <button
                onClick={() => setOpenId(openId === it.id ? null : it.id)}
                className="w-full text-left px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{it.item}</div>
                    <div className="text-xs text-white/45 truncate">
                      {it.requester || "shared"}
                      {it.spec ? ` · ${it.spec}` : ""}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] uppercase tracking-wide
                                px-2 py-0.5 rounded-full border
                                ${RIGIDITY_STYLE[it.rigidity] || ""}`}
                  >
                    {it.rigidity}
                  </span>
                </div>
                {it.reason && (
                  <div className="text-xs text-white/35 italic mt-1.5">
                    "{it.reason}"
                  </div>
                )}
              </button>

              {openId === it.id && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                  <Field
                    label="Item"
                    value={it.item}
                    onChange={(v) => updateItem(it.id, { item: v })}
                  />
                  <Field
                    label="Who asked"
                    value={it.requester || ""}
                    placeholder="leave blank if shared"
                    onChange={(v) =>
                      updateItem(it.id, { requester: v || null })
                    }
                  />
                  <Field
                    label="Spec"
                    value={it.spec || ""}
                    onChange={(v) => updateItem(it.id, { spec: v || null })}
                  />

                  <div>
                    <div className="text-xs text-white/40 mb-1.5">
                      How strict
                    </div>
                    <div className="flex gap-2">
                      {RIGIDITY.map((r) => (
                        <button
                          key={r}
                          onClick={() => updateItem(it.id, { rigidity: r })}
                          className={`px-3 py-1.5 rounded-lg text-xs border
                            ${
                              it.rigidity === r
                                ? RIGIDITY_STYLE[r]
                                : "border-white/10 text-white/40"
                            }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(it.id)}
                    className="text-xs text-red-400/70 hover:text-red-400"
                  >
                    Remove this item
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-neutral-950/95 backdrop-blur
                      border-t border-white/10 px-5 py-4">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 bg-neutral-900 rounded-xl
                          px-3 py-2.5 border border-white/10">
            <span className="text-white/40 text-sm">$</span>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-16 bg-transparent outline-none tabular-nums"
            />
          </div>
          <button
            onClick={go}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-white text-black font-medium
                       disabled:opacity-30"
          >
            {loading ? "Starting..." : "Start shopping"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-sm
                   outline-none focus:ring-1 ring-white/20"
      />
    </div>
  );
}