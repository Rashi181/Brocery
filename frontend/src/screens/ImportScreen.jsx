import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";

import SAMPLE from "../demo-chat.txt?raw";

export default function ImportScreen() {
  const nav = useNavigate();
  const { parseChat, loading, error } = useStore();
  const [text, setText] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) {
      useStore.getState().setError("Choose a text export under 500 KB");
      return;
    }
    setText(await file.text());
  }

  async function submit() {
    if (!text.trim()) return;
    try {
      await parseChat(text);
      nav("/review");
    } catch {
      /* store displays error */
    }
  }

  const lineCount = text.trim() ? text.trim().split("\n").length : 0;

  return (
    <div className="page">
      <p className="eyebrow">AccessCart</p>
      <h1>What does everyone need from the store?</h1>
      <p className="muted">
        Export the household chat from WhatsApp and drop it in below. Every
        item, restriction and budget gets pulled out automatically.
      </p>

      <div className="panel" style={{ marginTop: 18, padding: "18px 20px" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Pasted chat</label>
          <small className="muted">
            {lineCount ? `${lineCount} lines` : "waiting for text"}
          </small>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "9/26, 1:00 PM - Priya: can you grab oat milk\n9/26, 1:02 PM - Alex: yellow rubber duck for the kid, must be yellow"
          }
          rows={8}
          style={{ marginTop: 8 }}
        />
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <label className="button grow" style={{ margin: 0, textAlign: "center" }}>
          Upload .txt export
          <input type="file" accept=".txt" onChange={handleFile} hidden />
        </label>
        <button className="grow" onClick={() => setText(SAMPLE)}>
          Try a sample chat
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <button
        onClick={submit}
        disabled={!text.trim() || loading}
        className="primary"
        style={{ width: "100%", marginTop: 20, padding: "0.9rem" }}
      >
        {loading ? "Reading the chat…" : "Build the list"}
      </button>
    </div>
  );
}
