import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { api } from "../api";
import { downloadSummaryCard } from "../summaryCard";
export default function SettlementScreen() {
  const nav = useNavigate(),
    { tripId } = useStore(),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [scores, setScores] = useState([]),
    [finishing, setFinishing] = useState(false),
    [correction, setCorrection] = useState(""),
    [who, setWho] = useState(""),
    [saved, setSaved] = useState("");
  useEffect(() => {
    let live = true;
    if (tripId)
      api
        .getSettlement(tripId)
        .then((d) => {
          if (live) setData(d);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [tripId]);
  async function finish() {
    setFinishing(true);
    try {
      setData(await api.finish(tripId));
      setScores((await api.leaderboard()).runners);
    } catch (e) {
      setError(e.message);
    } finally {
      setFinishing(false);
    }
  }
  async function saveCorrection() {
    try {
      await api.sendCorrection(tripId, who, correction);
      setSaved("Saved to preference memory for the next run.");
      setCorrection("");
    } catch (e) {
      setError(e.message);
    }
  }
  function summary() {
    return [
      "AccessCart · household shopping summary",
      `Total: $${data.total.toFixed(2)} USD`,
      ...data.members.map((m) => `${m.name}: $${m.amount.toFixed(2)}`),
      "",
      ...data.lines.map(
        (l) =>
          `${l.requester}: ${l.quantity} × ${l.requested} — ${l.status}${l.product_name ? " (" + l.product_name + ")" : ""}${l.reason ? " · " + l.reason : ""}`,
      ),
      "",
      `Exact-match coverage: ${data.accuracy}% (${data.verified}/${data.requested})`,
      "No payment collected.",
    ].join("\n");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(summary());
      setCopied(true);
    } catch {
      setError("Clipboard unavailable. Use Download summary.");
    }
  }
  function download() {
    const a = document.createElement("a"),
      url = URL.createObjectURL(new Blob([summary()], { type: "text/plain" }));
    a.href = url;
    a.download = "accesscart-summary.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="page">
      <button onClick={() => nav("/cart")}>← Basket</button>
      <p className="eyebrow" style={{ marginTop: 22 }}>
        Back to the household
      </p>
      <h1>A good run, shared.</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!tripId ? (
        <button onClick={() => nav("/")}>Import chat</button>
      ) : !data ? (
        <p>Preparing the split…</p>
      ) : (
        <>
          <section className="panel">
            <p className="muted">Basket total · USD</p>
            <div className="hero-number">${data.total.toFixed(2)}</div>
            {data.members.map((m) => (
              <div className="split-row" key={m.name}>
                <span>{m.name}</span>
                <strong>${m.amount.toFixed(2)}</strong>
              </div>
            ))}
            <small className="muted">
              Shared items split across every chat participant. Remainder cents
              go in participant order.
            </small>
          </section>
          {!!data.pending && (
            <p className="notice">
              {data.pending} requests are still pending. This is a partial
              shopping summary.
            </p>
          )}
          <section className="panel mt-4">
            <p className="eyebrow">Trip score</p>
            <div className="hero-number">{data.accuracy}%</div>
            <h2>Exact-match coverage</h2>
            <p className="muted">{data.score_rule}</p>
            <small>
              {data.verified} verified matches / {data.requested} requests
            </small>
          </section>
          <button
            className="primary w-full mt-4"
            disabled={data.finished || finishing}
            onClick={finish}
          >
            {data.finished ? "Run recorded ✓" : "Finish run & record score"}
          </button>
          {!!scores.length && (
            <section className="panel mt-4">
              <h2>Household leaderboard</h2>
              {scores.map((r, i) => (
                <div className="split-row" key={r.name}>
                  <span>
                    {i + 1}. {r.name} · {r.runs} runs
                  </span>
                  <strong>{r.accuracy}%</strong>
                </div>
              ))}
            </section>
          )}
          <div className="row mt-6">
            <button className="primary grow" onClick={copy}>
              {copied ? "Copied ✓" : "Copy for group chat"}
            </button>
            <button onClick={download}>Download</button>
          </div>
          <button
            className="w-full mt-3"
            onClick={() => downloadSummaryCard(data)}
          >
            Save share card (PNG)
          </button>
          <section className="panel mt-4">
            <h2>Make the next run better</h2>
            <label>
              Whose preference?
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose a person</option>
                {data.members.map((m) => (
                  <option key={m.name}>{m.name}</option>
                ))}
              </select>
            </label>
            <label>
              Correction
              <textarea
                placeholder="For example: Priya prefers the unsweetened carton, not the vanilla one"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
              />
            </label>
            <button
              disabled={!who || !correction.trim()}
              onClick={saveCorrection}
            >
              Remember this
            </button>
            <p role="status">{saved}</p>
          </section>
          <p className="muted mt-3">
            Review and share it yourself. No messages or payments have been
            sent.
          </p>
        </>
      )}
    </main>
  );
}
