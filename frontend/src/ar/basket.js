export const purchasedLines = lines => lines.filter(l => ["purchased","substituted"].includes(l.status));
export const totalCents = lines => purchasedLines(lines).reduce((sum,l)=>sum+l.amount_cents,0);

export function requestedPackCount(quantity) {
 const match=String(quantity||"1").trim().match(/^(\d+)(?:\s|$)/);
 return match?Math.max(1,Math.min(100,Number(match[1]))):1;
}
