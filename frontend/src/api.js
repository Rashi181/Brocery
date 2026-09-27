// Every network call in the app goes through this file.

const BASE = import.meta.env.VITE_API_BASE || "/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    signal: AbortSignal.timeout(210000),
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error || body.detail || detail;
    } catch {
      /* retain HTTP error */
    }
    throw new Error(
      typeof detail === "string" ? detail : "Check the fields and try again.",
    );
  }
  return res.json();
}

const get = (path) => req(path);
const post = (path, body) =>
  req(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  scene: (body, signal) => req("/product/scene", {
    method: "POST", body: JSON.stringify(body), signal,
  }),
  identify: (body, signal) => req("/product/identify", {
    method: "POST", body: JSON.stringify(body), signal,
  }),
  observe: (body, signal) =>
    req("/product/observe", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  health: () => get("/health"),
  finish: (trip_id) => post("/trip/finish", { trip_id }),
  leaderboard: () => get("/leaderboard"),

  parseChat: (raw_text) => post("/chat/parse", { raw_text }),

  startTrip: (contract_id, budget, items, runner) =>
    post("/trip/start", { contract_id, budget, items, runner }),

  getAisles: (contract_id) =>
    get(`/aisles?contract_id=${encodeURIComponent(contract_id)}`),

  detect: (trip_id, image_b64, prompts, signal) =>
    req("/vision/detect", {
      method: "POST",
      body: JSON.stringify({ trip_id, image_b64, prompts }),
      ...(signal ? { signal } : {}),
    }),

  analyze: (trip_id, item_id, image_b64, scan_id) =>
    post("/product/analyze", { trip_id, item_id, image_b64, scan_id }),

  confirmItem: (trip_id, item_id, product_name, price, extra = {}) =>
    post("/item/confirm", { trip_id, item_id, product_name, price, ...extra }),

  substituteItem: (trip_id, item_id, product_name, price, reason, extra = {}) =>
    post("/item/substitute", {
      trip_id,
      item_id,
      product_name,
      price,
      reason,
      ...extra,
    }),

  skipItem: (trip_id, item_id, reason) =>
    post("/item/skip", { trip_id, item_id, reason }),

  getCart: (trip_id) => get(`/cart?trip_id=${encodeURIComponent(trip_id)}`),

  undo: (trip_id, item_id) => post("/item/undo", { trip_id, item_id }),

  getSettlement: (trip_id) =>
    get(`/settlement?trip_id=${encodeURIComponent(trip_id)}`),

  getPreferences: (requester) =>
    get(`/preferences?requester=${encodeURIComponent(requester)}`),

  sendCorrection: (trip_id, requester, text) =>
    post("/preferences/correction", { trip_id, requester, text }),
};
