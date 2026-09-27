export function pendingRequests(aisles, lines) {
  const wanted = new Set(lines.filter((l) => l.status === "pending").map((l) => l.item_id));
  return [...new Map(aisles.flatMap((a) => a.items).filter((i) => wanted.has(i.id)).map((i) => [i.id, i])).values()];
}

export function requestedProducts(products, items) {
  const wanted = new Set(items.map((i) => i.id));
  return products.map((p) => ({...p, matched_item_ids: p.matched_item_ids.filter((id) => wanted.has(id))}))
    .filter((p) => p.matched_item_ids.length > 0);
}

export function checkoutLines(lines) {
  return lines.filter((l) => ["purchased", "substituted"].includes(l.status));
}
