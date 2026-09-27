// Never let a repeatedly lost/held first packet starve the other packet.
export function orderReads(tracks, readings, heldId) {
  return [...tracks].sort((a, b) => {
    const aTime = readings.get(a.id)?.attemptedAt ?? -Infinity;
    const bTime = readings.get(b.id)?.attemptedAt ?? -Infinity;
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    return Number(b.id === heldId) - Number(a.id === heldId);
  });
}
