import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PanelApp } from "./panel/PanelApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <PanelApp platform={platform} />}</Boot>
  </StrictMode>,
);
