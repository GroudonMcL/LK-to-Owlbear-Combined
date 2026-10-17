// Shown when the browser blocked opening a tab straight from a context menu
// click: one click here counts as the user's own, so the tab opens.

import { SquareArrowOutUpRight } from "lucide-react";
import { TAB_MODAL_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { AppHeader, Button, useTheme } from "../ui/components";

const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "";
const name = params.get("name") ?? "this page";
const safeUrl = url.startsWith("https://www.legendkeeper.com/") ? url : "";

export function TabApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const close = () => void platform.closeModal(TAB_MODAL_ID);
  return (
    <div className="app">
      <AppHeader title="Open in a new tab?" sub={name} />
      <main className="app-body row" style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <a className="btn btn-primary" href={safeUrl} target="_blank" rel="noopener noreferrer" onClick={close}>
          <SquareArrowOutUpRight /> Open page
        </a>
      </main>
    </div>
  );
}
