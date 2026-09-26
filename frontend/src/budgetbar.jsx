// The budget bar. ONE component, used everywhere.
//
// PERSON 1: import this into your WebXR DOM overlay. Do not build a
// second one, or the AR view and the rest of the app will drift apart.
//
//   import BudgetBar from "../components/BudgetBar";
//   <BudgetBar compact />

import { useStore } from "../store";

export default function BudgetBar({ compact = false }) {
  const { budget, spent, remaining, overBudget } = useStore();

  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const barColor = overBudget
    ? "bg-red-500"
    : pct > 80
    ? "bg-amber-500"
    : "bg-emerald-500";

  return (
    <div
      className={`w-full ${
        compact ? "px-3 py-2" : "px-4 py-3"
      } bg-neutral-900/90 backdrop-blur rounded-xl text-white`}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <span className={compact ? "text-xs opacity-60" : "text-sm opacity-60"}>
          Remaining
        </span>
        <span
          className={`font-semibold tabular-nums ${
            compact ? "text-xl" : "text-2xl"
          } ${overBudget ? "text-red-400" : ""}`}
        >
          ${remaining.toFixed(2)}
        </span>
      </div>

      <div className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!compact && (
        <div className="flex justify-between mt-1.5 text-xs opacity-50 tabular-nums">
          <span>${spent.toFixed(2)} spent</span>
          <span>${budget.toFixed(2)} budget</span>
        </div>
      )}
    </div>
  );
}