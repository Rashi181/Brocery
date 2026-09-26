// Every network call in the app goes through this file.

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error || body.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

const get = (path) => req(path);
const post = (path, body) =>
  req(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => get("/health"),

  parseChat: (raw_text) => post("/chat/parse", { raw_text }),

  startTrip: (contract_id, budget) =>
    post("/trip/start", { contract_id, budget }),

  getAisles: (contract_id) =>
    get(`/aisles?contract_id=${encodeURIComponent(contract_id)}`),

  detect: (image_b64, prompts) => post("/vision/detect", { image_b64, prompts }),

  analyze: (trip_id, item_id, image_b64) =>
    post("/product/analyze", { trip_id, item_id, image_b64 }),

  confirmItem: (trip_id, item_id, product_name, price) =>
    post("/item/confirm", { trip_id, item_id, product_name, price }),

  substituteItem: (trip_id, item_id, product_name, price, reason) =>
    post("/item/substitute", { trip_id, item_id, product_name, price, reason }),

  skipItem: (trip_id, item_id, reason) =>
    post("/item/skip", { trip_id, item_id, reason }),

  getCart: (trip_id) => get(`/cart?trip_id=${encodeURIComponent(trip_id)}`),

  checkout: (trip_id) => post("/checkout", { trip_id }),

  getSettlement: (trip_id) =>
    get(`/settlement?trip_id=${encodeURIComponent(trip_id)}`),

  getPreferences: (requester) =>
    get(`/preferences?requester=${encodeURIComponent(requester)}`),

  sendCorrection: (trip_id, requester, text) =>
    post("/preferences/correction", { trip_id, requester, text }),
};