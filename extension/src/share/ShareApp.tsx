// The GM's dialog when a player asks to open a page for everyone.

import { Users } from "lucide-react";
import { useState } from "react";
import { describeOpenError, openTextMatch } from "../lib/open";
import { openForEveryone, parseSharedPage } from "../lib/share";
import { SHARE_MODAL_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { AppHeader, Button, useTheme } from "../ui/components";

const params = new URLSearchParams(location.search);
const page = parseSharedPage({
  projectId: params.get("project"),
  resourceId: params.get("resource"),
  name: params.get("name"),
  from: params.get("from"),
});

export function ShareApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const [busy, setBusy] = useState(false);
  const close = () => void platform.closeModal(SHARE_MODAL_ID);

  const approve = async () => {
    if (!page) return close();
    setBusy(true);
    try {
      await openForEveryone(platform, page);
      await openTextMatch(platform, { resourceId: page.resourceId, name: page.name });
    } catch (err) {
      await platform.notify(describeOpenError(err), "ERROR");
    }
    close();
  };

  return (
    <div className="app">
      <AppHeader title="Open for everyone?" sub={page ? `${page.from} asks to show “${page.name}” to everyone.` : "This request is unreadable."} />
      <main className="app-body row" style={{ justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={close}>
          Not now
        </Button>
        <Button variant="primary" icon={<Users />} loading={busy} disabled={!page} onClick={() => void approve()}>
          Open for everyone
        </Button>
      </main>
    </div>
  );
}
