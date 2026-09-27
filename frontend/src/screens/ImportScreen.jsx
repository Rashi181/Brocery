import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";

import SAMPLE from "../demo-chat.txt?raw";

const MAX_CHARS = 500000;
const MESSAGE_LINE =
  /^\s*\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s[^\]-]*?\]?\s*-?\s*([^:\n]{1,40}):/;

function summarize(text) {
  const people = new Set();
  let messages = 0;
  for (const line of text.split("\n")) {
    const m = line.match(MESSAGE_LINE);
    if (m) {
      messages++;
      people.add(m[1].trim());
    }
  }
  return { people: people.size, messages };
}

const icon = {
  bag: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
      <path d="M10 13.5l2 1.5 2-1.5" />
    </svg>
  ),
  chat: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth="2.6" />
    </svg>
  ),
  file: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M9.5 14.5l2 2 3.5-4" />
    </svg>
  ),
  help: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01" />
    </svg>
  ),
  chevron: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
};

export default function ImportScreen() {
  const nav = useNavigate();
  const { parseChat, loading, error, setError } = useStore();
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [dragging, setDragging] = useState(false);
  const [howto, setHowto] = useState(false);

  async function load(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type !== "text/plain") {
      setError("Choose the .txt file that WhatsApp exports");
      return;
    }
    if (file.size > MAX_CHARS) {
      setError("Choose a text export under 500 KB");
      return;
    }
    setError("");
    setText(await file.text());
    setSource(file.name);
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

  const { people, messages } = summarize(text);
  const status = !text.trim()
    ? "Waiting for text…"
    : messages
      ? `${people} ${people === 1 ? "person" : "people"} · ${messages} messages`
      : `${text.trim().split("\n").length} lines`;

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <span className="app-tile">{icon.bag}</span>
          BroCery
        </div>
        <button
          className="pill-btn"
          aria-expanded={howto}
          onClick={() => setHowto(!howto)}
        >
          {icon.help}
          How it works
        </button>
      </header>

      <h1>
        What do your bros need
        <span className="h1-accent">from the store?</span>
      </h1>
      <p className="lede">
        Export the household chat from WhatsApp and drop it in below. Every
        item, restriction and budget gets pulled out automatically.
      </p>

      {howto && (
        <section className="howto-panel glass">
          <strong>Export the chat from WhatsApp</strong>
          <ol>
            <li>Open the group chat and tap its name.</li>
            <li>Tap Export chat, then Without media.</li>
            <li>Upload the .txt file here. You review every request before shopping.</li>
          </ol>
        </section>
      )}

      <section
        className={`chat-card glass ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          load(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="card-head">
          <span className="title">
            <span className="icon-circle">{icon.chat}</span>
            {source || "Pasted chat"}
          </span>
          <span className={`status-pill ${text.trim() ? "ready" : ""}`} role="status">
            {status}
          </span>
        </div>

        <div className="chat-field">
          <textarea
            id="chat-text"
            aria-label="Chat export text"
            value={text}
            maxLength={MAX_CHARS}
            onChange={(e) => {
              setText(e.target.value);
              if (!e.target.value) setSource("");
            }}
            placeholder={
              "9/26, 1:00 PM - Priya: can you grab oat milk\n9/26, 1:02 PM - Alex: yellow rubber duck for the kid, must be yellow"
            }
          />
          <span className="char-count">
            {text.length.toLocaleString()}/{MAX_CHARS.toLocaleString()}
          </span>
        </div>

        <div className="action-tiles">
          <label className="tile button">
            <input
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={(e) => {
                load(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <span className="icon-circle">{icon.file}</span>
            <span className="grow">
              <strong>Upload .txt export</strong>
              <small>From WhatsApp</small>
            </span>
            <span className="chev">{icon.chevron}</span>
          </label>
          <button
            className="tile"
            onClick={() => {
              setError("");
              setText(SAMPLE);
              setSource("Sample household chat");
            }}
          >
            <span className="icon-circle">{icon.chat}</span>
            <span className="grow">
              <strong>Try a sample chat</strong>
              <small>See how it works</small>
            </span>
            <span className="chev">{icon.chevron}</span>
          </button>
        </div>
      </section>

      <div className="submit-area">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary cta block"
          onClick={submit}
          disabled={!text.trim() || loading}
        >
          {loading ? "Reading the chat…" : "Bro, make the list"}
        </button>
        <p className="fineprint">
          Nothing is bought or sent. You approve every item.
        </p>
      </div>
    </main>
  );
}
