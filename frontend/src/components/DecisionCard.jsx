import { useState } from "react";
import { useStore } from "../store";

export default function DecisionCard({
  item,
  result,
  image,
  onDone,
  onRetake,
  onAlternative,
  live = false,
}) {
  const { confirmItem, substituteItem, skipItem } = useStore();
  const [price, setPrice] = useState(
    result.price == null || !/^(1|one)(\s|$)/i.test(item.quantity)
      ? ""
      : String(result.price),
  );
  const [unitPrice, setUnitPrice] = useState(
    result.price == null ? "" : String(result.price),
  );
  const [name, setName] = useState(result.product_name || "");
  const [reason, setReason] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const priceConflict =
    item.max_price != null &&
    (unitPrice === "" || Number(unitPrice) > item.max_price);
  const needsDecision =
    !result.match ||
    name.trim() !== result.product_name.trim() ||
    priceConflict;
  async function act(kind) {
    setBusy(true);
    setError("");
    try {
      const extra = {
        analysis_id: result.analysis_id,
        unit_price: unitPrice === "" ? null : Number(unitPrice),
        override: needsDecision || kind === "substitute",
        reason,
      };
      if (kind === "skip")
        await skipItem(
          item.id,
          reason ||
            (result.decision === "skip"
              ? "Strict requirement not met"
              : "Shopper skipped"),
        );
      else if (kind === "substitute")
        await substituteItem(item.id, name, Number(price), reason, extra);
      else await confirmItem(item.id, name, Number(price), extra);
      onDone(
        kind === "skip"
          ? "Request skipped"
          : `Added ${name} for ${item.shared ? "the household" : item.requester}`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`decision panel ${expanded ? "expanded" : ""}`}
      aria-label="Product decision"
    >
      <button
        className="item-head"
        onDoubleClick={() => setExpanded(!expanded)}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="eyebrow">
          {result.match
            ? "MATCH CHECKED"
            : result.decision === "skip"
              ? "STRICT REQUEST · CONFLICT"
              : "YOUR DECISION NEEDED"}
        </span>
        <span>{expanded ? "−" : "+"}</span>
      </button>
      <h2>{result.product_name}</h2>
      <p className="muted">
        For {item.requester} · {item.quantity} × {item.item}
      </p>
      {item.reason && <p className="quote">“{item.reason}”</p>}
      <ul className="checklist">
        {result.checklist.slice(0, expanded ? 100 : 5).map((c, i) => (
          <li className={c.status} key={i}>
            <b>{c.status === "pass" ? "✓" : c.status === "fail" ? "×" : "?"}</b>
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
      {result.checklist.length > 5 && !expanded && (
        <button onClick={() => setExpanded(true)}>
          See all {result.checklist.length} checks
        </button>
      )}
      {expanded && (
        <>
          <img
            className="evidence-photo"
            src={image}
            alt="Photo used for this product check"
          />
          <p className="muted">
            A photo can leave ingredients unreadable. A check is not an allergen
            guarantee.
          </p>
        </>
      )}
      {result.alternative && (
        <button
          className="alternative"
          onClick={() => onAlternative(result.alternative)}
        >
          Look on the captured shelf: {result.alternative.text} →
        </button>
      )}
      <div className="row">
        <label className="grow">
          Confirm product
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="price-field">
          Total USD
          <input
            type="number"
            min="0"
            step=".01"
            placeholder="Price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
      </div>
      {item.max_price != null && (
        <label>
          Unit price USD · requested limit ${item.max_price.toFixed(2)}
          <input
            type="number"
            min="0"
            step=".01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </label>
      )}
      <small className="muted">
        Total price for {item.quantity} requested. Check the shelf price and
        quantity yourself.
      </small>
      {(needsDecision || item.rigidity !== "strict") && (
        <label>
          Decision / replacement reason
          <textarea
            rows="2"
            placeholder="Why this replacement works, or why you are overriding a check"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        I checked the product, quantity and total price
        {needsDecision ? " and accept the unresolved/conflicting checks" : ""}
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row">
        <button
          className="primary grow"
          disabled={
            busy ||
            !accepted ||
            price === "" ||
            Number(price) < 0 ||
            !name.trim() ||
            (needsDecision && !reason.trim())
          }
          onClick={() => act("confirm")}
        >
          {needsDecision ? "Record decision & add" : "Confirm & add"}
        </button>
        <button disabled={busy} onClick={() => act("skip")}>
          Skip
        </button>
      </div>
      {item.rigidity !== "strict" && (
        <button
          disabled={
            busy ||
            !accepted ||
            price === "" ||
            Number(price) < 0 ||
            !name.trim() ||
            !reason.trim()
          }
          onClick={() => act("substitute")}
        >
          Record as substitution
        </button>
      )}
      <button disabled={busy} onClick={onRetake}>
        {live ? "Back to live checks" : "Read another side / retake"}
      </button>
    </section>
  );
}
