import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorApp } from "./editor/EditorApp";
import { preloadFrameImages } from "./editor/imageFrames";
import { Boot } from "./ui/Boot";
import "./ui/styles.css";
import "./editor/editor.css";

// The artwork frames must be loaded before the first render: rendering is synchronous.
await preloadFrameImages();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot>{(platform) => <EditorApp platform={platform} />}</Boot>
  </StrictMode>,
);
