// PERSON 1: THIS FILE IS YOURS. Replace everything below the imports.
//
// What you get from the store:
//   currentAisle   -> { aisle, aisle_no, items: [...] }
//   pendingItems   -> items in this aisle not yet handled
//   remaining      -> budget left, already computed
//   confirmItem(itemId, productName, price)
//   substituteItem(itemId, productName, price, reason)
//   skipItem(itemId, reason)
//
// What you call directly for vision:
//   api.detect(image_b64, prompts)         -> { detections: [{prompt, bbox, confidence}] }
//   api.analyze(tripId, itemId, image_b64) -> { match, product_name, price, checklist, alternative }
//
// bbox is ALWAYS normalized 0..1 as [x, y, w, h], origin top-left.
// image_b64 is raw base64, no data: prefix, JPEG, max 640px wide.
//
// Mount your WebXR canvas here. Keep <BudgetBar compact /> in the
// DOM overlay so the budget looks identical inside and outside AR.

import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import BudgetBar from "../components/BudgetBar";

export default function ARScreen() {
  const nav = useNavigate();
  const { currentAisle, pendingItems, confirmItem } = useStore();

  if (!currentAisle) {
    return (
      <div className="min-h-dvh bg-neutral-950 text-white grid place-items-center">
        <button onClick={() => nav("/aisles")} className="underline text-sm">
          No aisle selected.
        </button>
      </div>
    );
  }

  // --- TEMPORARY placeholder so the flow is walkable before AR exists ---
  return (
    <div className="min-h-dvh bg-neutral-950 text-white flex flex-col">
      <div className="px-4 pt-4">
        <BudgetBar compact />
      </div>

      <div className="flex-1 grid place-items-center px-6">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-white/30 mb-2">
            Aisle {currentAisle.aisle_no}
          </div>
          <div className="text-lg font-medium mb-1">{currentAisle.aisle}</div>
          <div className="text-sm text-white/40">
            AR view goes here
          </div>
        </div>
      </div>

      <div className="px-4 pb-6 space-y-2">
        {pendingItems.map((it) => (
          <button
            key={it.id}
            onClick={() => confirmItem(it.id, `${it.item} (placeholder)`, 4.99)}
            className="w-full text-left px-4 py-3 bg-neutral-900 rounded-xl
                       border border-white/10 flex justify-between items-center"
          >
            <div>
              <div className="text-sm">{it.item}</div>
              <div className="text-xs text-white/40">
                {it.requester || "shared"}
              </div>
            </div>
            <span className="text-xs text-white/40">tap to fake-confirm</span>
          </button>
        ))}

        <button
          onClick={() => nav("/aisles")}
          className="w-full py-3 rounded-xl bg-white/10 text-sm"
        >
          Back to route
        </button>
      </div>
    </div>
  );
}