import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";

const SAMPLE = `22/09/2026, 19:04 - Priya: can someone grab oat milk when you go
22/09/2026, 19:04 - Priya: unsweetened pls, under $5 if you can
22/09/2026, 19:07 - Arjun: pasta too
22/09/2026, 19:07 - Arjun: NOT the whole wheat one again
22/09/2026, 19:12 - Priya: oh and greek yogurt if they have the big tub, plain
22/09/2026, 19:15 - Arjun: coffee beans, medium roast, whole bean not ground
22/09/2026, 19:20 - Priya: we're out of dish soap btw
22/09/2026, 19:21 - Arjun: the sweet oat milk last time made my coffee gross
22/09/2026, 19:21 - Priya: that was MY coffee lol`;

export default function ImportScreen() {
  const nav = useNavigate();
  const { parseChat, loading, error } = useStore();
  const [text, setText] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
  }

  async function submit() {
    if (!text.trim()) return;
    await parseChat(text);
    nav("/review");
  }

  return (
    <div className="min-h-dvh bg-neutral-950 text-white px-5 py-8">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Import your group chat</h1>
        <p className="text-sm text-white/50 mb-6">
          Export the thread from WhatsApp and paste it here. Everything the
          household asked for gets pulled out automatically.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the exported chat..."
          className="w-full h-64 bg-neutral-900 border border-white/10 rounded-xl
                     p-4 text-sm font-mono resize-none outline-none
                     focus:border-white/30"
        />

        <div className="flex gap-3 mt-3 text-sm">
          <label className="px-3 py-2 rounded-lg bg-neutral-800 cursor-pointer
                            hover:bg-neutral-700">
            Upload .txt
            <input type="file" accept=".txt" onChange={handleFile} hidden />
          </label>
          <button
            onClick={() => setText(SAMPLE)}
            className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700"
          >
            Use sample
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={!text.trim() || loading}
          className="w-full mt-6 py-3.5 rounded-xl bg-white text-black
                     font-medium disabled:opacity-30"
        >
          {loading ? "Reading the chat..." : "Build the list"}
        </button>
      </div>
    </div>
  );
}