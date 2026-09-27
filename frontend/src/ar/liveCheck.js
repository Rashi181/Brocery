// Developer-only standalone entry. Not imported by the production app.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import ARScreen from "../screens/ARScreen";
import { useStore } from "../store";
import { LiveCamera } from "./LiveCamera";
import "../index.css";
const report = document.getElementById("report");
const canvas = document.getElementById("sample");
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ddd";
ctx.fillRect(0, 0, 320, 240);
const hand = new Worker("/hand-worker.js");
hand.postMessage({ type: "init", base: location.origin });
hand.onmessage = async ({ data }) => {
  if (data.type === "ready") {
    report.textContent = "PASS: MediaPipe hand model loaded in worker.\n";
    const image = await createImageBitmap(canvas);
    hand.postMessage({ type: "frame", image, time: performance.now() }, [
      image,
    ]);
  }
  if (data.type === "hands") {
    report.textContent += `PASS: Hand inference completed (${data.landmarks.length} hands on blank frame).\n`;
    hand.terminate();
  }
  if (data.type === "error") {
    report.textContent = `FAIL: ${data.message}`;
    hand.terminate();
  }
  if (data.type === "inference-error") {
    report.textContent = `FAIL: Inference: ${data.message}`;
    hand.terminate();
  }
};
hand.onerror = (e) => {
  report.textContent = `FAIL: ${e.message}`;
};

document.getElementById("run").onclick = () => {
  canvas.width = 480;
  canvas.height = 720;
  const paint = () => {
    ctx.fillStyle = "#d4ceba";
    ctx.fillRect(0, 0, 480, 720);
    for (const [x, color, label] of [
      [40, "#b74524", "CHIPS"],
      [260, "#245eae", "OREO"],
    ]) {
      ctx.fillStyle = color;
      ctx.fillRect(x, 250, 165, 275);
      for (let j = 0; j < 275; j += 4)
        for (let i = 0; i < 165; i += 4) {
          ctx.fillStyle = `rgba(255,255,255,${((i * 37 + j * 53) % 255) / 700})`;
          ctx.fillRect(x + i, 250 + j, 3, 3);
        }
      ctx.fillStyle = "white";
      ctx.font = "bold 25px sans-serif";
      ctx.fillText(label, x + 18, 310);
    }
  };
  paint();
  const interval = setInterval(paint, 80);
  const services = {
    detect: async () => ({
      detections: [
        { prompt: "chips", bbox: [40 / 480, 250 / 720, 165 / 480, 275 / 720] },
        { prompt: "Oreo", bbox: [260 / 480, 250 / 720, 165 / 480, 275 / 720] },
      ],
    }),
    observe: async (body) => {
      await new Promise((r) => setTimeout(r, 500));
      const chips = body.track_id.endsWith("1");
      return {
        track_id: body.track_id,
        sequence: body.sequence,
        product_name: chips ? "Chips" : "Oreo cookies",
        view: "front",
        same_product: "yes",
        visible_text: "SYNTHETIC TEST · packaging evidence",
        assessments: [
          {
            item_id: chips ? "chips" : "oreo",
            identity: "pass",
            result: {
              analysis_id: "demo-" + body.track_id,
              product_name: chips ? "Chips" : "Oreo cookies",
              price: null,
              match: false,
              decision: "review",
              checklist: [
                { status: "pass", text: "Product identity checked" },
                { status: "warn", text: "Ingredients not yet readable" },
                { status: "warn", text: "Price not visible" },
              ],
            },
          },
        ],
      };
    },
  };
  const items = [
    {
      id: "chips",
      item: "chips",
      requester: "Alex",
      quantity: "1 bag",
      spec: "plain",
      avoid: ["dairy"],
      rigidity: "strict",
    },
    {
      id: "oreo",
      item: "Oreo",
      requester: "Priya",
      quantity: "1 packet",
      spec: "original",
      avoid: [],
      rigidity: "preferred",
    },
  ];
  useStore.setState({
    tripId: "synthetic-only",
    budget: 20,
    spent: 0,
    remaining: 20,
    items,
    aisles: [{ aisle_no: 3, aisle: "Snacks", items }],
    currentAisleNo: 3,
    lines: items.map((i) => ({ item_id: i.id, status: "pending" })),
  });
  let fixtureEngine;
  function createEngine(...args) {
    const engine = new LiveCamera(...args, services),
      start = engine.start.bind(engine),
      close = engine.close.bind(engine);
    fixtureEngine = engine;
    engine.start = () => start(canvas.captureStream(12));
    engine.close = () => {
      clearInterval(interval);
      close();
    };
    return engine;
  }
  const pinch = document.createElement("button");
  pinch.textContent = "Replay air-pinch landmarks";
  pinch.style.cssText =
    "position:fixed;right:12px;bottom:10px;z-index:100;background:#654b14;font-size:11px";
  document.body.appendChild(pinch);
  pinch.onclick = () => {
    const e = fixtureEngine;
    e.handsReady = false;
    if (pinch.textContent === "Pinch replay finished") {
      let steps = 0;
      const scroll = setInterval(() => {
        const c = e.cb.cards()[0];
        const x = c.box[0] + c.box[2] / 2,
          y = c.box[1] + c.box[3] * 0.92,
          palm = 0.15;
        const h = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
        h[5] = { x: x - palm / 2, y };
        h[17] = { x: x + palm / 2, y };
        h[4] = { x: x - 0.08, y };
        h[8] = { x: x + 0.08, y };
        e.lastHands = performance.now();
        e.hands = [h];
        e.gestures();
        if (++steps > 25) {
          clearInterval(scroll);
          e.hands = [];
          e.gestures();
          pinch.textContent = "Air-scroll replay finished";
        }
      }, 120);
      return;
    }
    let step = 0;
    const replay = setInterval(() => {
      const c = e.cb.cards()[0];
      if (!c) return;
      const aperture =
        step < 5 ? 0.12 : Math.min(1.2, 0.12 + (step - 4) * 0.15);
      const x = c.box[0] + c.box[2] * 0.5,
        y = c.box[1] + c.box[3] * 0.25,
        palm = 0.15;
      const h = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
      h[5] = { x: x - palm / 2, y };
      h[17] = { x: x + palm / 2, y };
      h[4] = { x: x - (aperture * palm) / 2, y };
      h[8] = { x: x + (aperture * palm) / 2, y };
      e.lastHands = performance.now();
      e.hands = [h];
      e.gestures();
      if (++step > 15) {
        clearInterval(replay);
        e.hands = [];
        e.gestures();
        pinch.textContent = "Pinch replay finished";
      }
    }, 120);
  };
  createRoot(document.getElementById("root")).render(
    React.createElement(
      BrowserRouter,
      null,
      React.createElement(ARScreen, {
        mode: "SYNTHETIC TEST · no camera / no AI calls",
        createEngine,
      }),
    ),
  );
};
