import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShareApp } from "./share/ShareApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <ShareApp platform={platform} />}</Boot>
  </StrictMode>,
);
