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
  const level = overBudget ? "over" : pct > 80 ? "high" : "";

  return (
    <div
      className={`budget ${compact ? "compact" : ""} ${overBudget ? "over" : ""}`}
    >
      <div className="budget-head">
        <span>Remaining</span>
        <strong>${remaining.toFixed(2)}</strong>
      </div>
      <div className="budget-track">
        <div className={`budget-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <div className="budget-foot">
          <span>${spent.toFixed(2)} spent</span>
          <span>${budget.toFixed(2)} budget</span>
        </div>
      )}
    </div>
  );
}
