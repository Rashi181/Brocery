import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ImportScreen from "./screens/ImportScreen";
import ReviewScreen from "./screens/ReviewScreen";
import AislesScreen from "./screens/AislesScreen";
const ARScreen = lazy(() => import("./screens/ARScreen"));
import CartScreen from "./screens/CartScreen";
import SettlementScreen from "./screens/SettlementScreen";
import { api } from "./api";
export default function App() {
  const [mode, setMode] = useState("Connecting to backend…");
  useEffect(() => {
    api
      .health()
      .then((h) =>
        setMode(
          h.llm_mode === "mock" || h.sam_mode === "mock"
            ? "DEMO FIXTURES · not live AI"
            : !h.key_configured
              ? "API key missing · configure backend/.env"
              : "",
        ),
      )
      .catch(() => setMode("Backend offline · start backend/start.ps1"));
  }, []);
  return (
    <BrowserRouter>
      {mode && (
        <div className="mode-banner" role="status">
          {mode}
        </div>
      )}
      <Routes>
        <Route path="/" element={<ImportScreen />} />
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/aisles" element={<AislesScreen />} />
        <Route
          path="/ar"
          element={
            <Suspense
              fallback={<main className="page">Preparing camera…</main>}
            >
              <ARScreen mode={mode} />
            </Suspense>
          }
        />
        <Route path="/cart" element={<CartScreen />} />
        <Route path="/settle" element={<SettlementScreen />} />
        <Route path="*" element={<ImportScreen />} />
      </Routes>
    </BrowserRouter>
  );
}
