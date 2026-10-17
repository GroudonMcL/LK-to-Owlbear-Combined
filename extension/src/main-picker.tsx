import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PickerApp } from "./picker/PickerApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <PickerApp platform={platform} />}</Boot>
  </StrictMode>,
);
