export function downloadSummaryCard(data) {
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  const lines = [
    `${data.runner}'s household run`,
    ...data.members.map((m) => `${m.name} · $${m.amount.toFixed(2)}`),
    "",
    ...data.lines
      .flatMap((l) => [
        `${l.requester} · ${l.quantity} × ${l.requested}`,
        `${l.status.toUpperCase()}${l.product_name ? " · " + l.product_name : ""}`,
        l.reason || "",
      ])
      .filter(Boolean),
    "",
    `Exact-match coverage: ${data.accuracy}%`,
    `$${data.total.toFixed(2)} USD · No payment collected`,
  ];
  canvas.width = 900;
  ctx.font = "25px sans-serif";
  const wrapped = lines.flatMap((line) => {
    const words = line.split(" "),
      out = [];
    let current = "";
    for (const word of words) {
      if (ctx.measureText(current + " " + word).width > 790) {
        out.push(current);
        current = word;
      } else current += (current ? " " : "") + word;
    }
    out.push(current);
    return out;
  });
  canvas.height = 220 + wrapped.length * 42;
  ctx.fillStyle = "#0d1913";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#8aedbd";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText("ACCESSCART", 50, 80);
  ctx.fillStyle = "#edf7f1";
  ctx.font = "25px sans-serif";
  wrapped.forEach((line, i) => ctx.fillText(line, 50, 150 + i * 42));
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "accesscart-household.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
