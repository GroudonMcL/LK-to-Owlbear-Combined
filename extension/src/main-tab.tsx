import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TabApp } from "./tab/TabApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <TabApp platform={platform} />}</Boot>
  </StrictMode>,
);
