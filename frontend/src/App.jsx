import { BrowserRouter, Routes, Route } from "react-router-dom";
import ImportScreen from "./screens/ImportScreen";
import ReviewScreen from "./screens/ReviewScreen";
import AislesScreen from "./screens/AislesScreen";
import ARScreen from "./screens/ARScreen";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ImportScreen />} />
        <Route path="/review" element={<ReviewScreen />} />
        <Route path="/aisles" element={<AislesScreen />} />
        <Route path="/ar" element={<ARScreen />} />
        {/* /cart and /settle come next */}
      </Routes>
    </BrowserRouter>
  );
}