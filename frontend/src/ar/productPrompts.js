// Segment the container, not food pictured on the container.
export function productPrompt(item) {
  if (/\b(chips?|doritos|cheetos)\b/i.test(item)) return "bag of chips";
  if (/\b(oreo|cookies?|biscuits?)\b/i.test(item)) return "cookie package";
  if (/\b(crackers?|cheez.it)\b/i.test(item)) return "cracker package";
  if (/\bsnacks?\b/i.test(item)) return "snack package";
  return item;
}

export function categoryLabel(prompts = []) {
  const labels = [...new Set(prompts.filter((p) => p !== "food package")
    .map((p) => ({"bag of chips": "Chips packet", "cookie package": "Cookie packet",
      "cracker package": "Cracker packet", "snack package": "Snack packet"})[p] || p))];
  return labels.length === 1 ? labels[0] : "Food package";
}

export function categoryAssessments(prompts, items) {
  return items.filter((i) => prompts.includes(productPrompt(i.item))).map((item) => ({
    item_id: item.id,
    identity: "unknown",
    result: {
      product_name: categoryLabel(prompts), price: null, match: false,
      analysis_id: null, alternative: null,
      checklist: ["Exact product not verified", item.spec,
        ...(item.avoid || []).map((a) => `Avoid ${a} · ingredients not read`),
        "Price not verified"].filter(Boolean).map((text) => ({status: "unknown", text})),
    },
  }));
}

// Small context margin keeps edge lettering in frame without using the entire scene.
export function readingBox([x, y, w, h]) {
  const left = Math.max(0, x - w * 0.12);
  const top = Math.max(0, y - h * 0.12);
  return [left, top, Math.min(1, x + w * 1.12) - left,
    Math.min(1, y + h * 1.12) - top];
}
