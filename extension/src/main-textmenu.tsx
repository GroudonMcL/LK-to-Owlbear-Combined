import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TextMenuApp } from "./textmenu/TextMenuApp";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <TextMenuApp platform={platform} />}</Boot>
  </StrictMode>,
);
