// The GM's dialogs when a player asks: to open a page for everyone, or
// (kind=access) to search pages and make tokens.

import { Users, Wand2 } from "lucide-react";
import { useState } from "react";
import { describeOpenError, openTextMatch } from "../lib/open";
import { describeError } from "../lib/api";
import { answerAccess } from "../lib/playerAccess";
import { openForEveryone, parseSharedPage } from "../lib/share";
import { ACCESS_MODAL_ID, SHARE_MODAL_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { AppHeader, Button, useTheme } from "../ui/components";

const params = new URLSearchParams(location.search);
const page = parseSharedPage({
  projectId: params.get("project"),
  resourceId: params.get("resource"),
  name: params.get("name"),
  from: params.get("from"),
});

const accessPlayer = params.get("kind") === "access" ? params.get("player") : null;

export function ShareApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  if (accessPlayer) return <AccessDialog platform={platform} playerId={accessPlayer} />;
  return <ShareDialog platform={platform} />;
}

function AccessDialog({ platform, playerId }: { platform: Platform; playerId: string }) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = params.get("from") || "A player";
  const answer = async (allow: boolean) => {
    setBusy(allow ? "allow" : "deny");
    try {
      await answerAccess(platform, playerId, allow);
      if (allow) await platform.notify(`${from} can now search pages and make tokens.`, "SUCCESS");
      await platform.closeModal(ACCESS_MODAL_ID);
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  };
  return (
    <div className="app">
      <AppHeader title="Let them make tokens?" sub={`${from} asks to search LegendKeeper and make tokens.`} />
      <main className="app-body stack">
        <div className="small muted">
          They'll see public pages only, without hidden tabs, fields or secrets, for the next 12 hours. Their tokens go into their own
          Owlbear storage and are never hidden.
        </div>
        {error && <div className="small" style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" loading={busy === "deny"} disabled={busy !== null} onClick={() => void answer(false)}>
            Not now
          </Button>
          <Button variant="primary" icon={<Wand2 />} loading={busy === "allow"} disabled={busy !== null} onClick={() => void answer(true)}>
            Allow
          </Button>
        </div>
      </main>
    </div>
  );
}

function ShareDialog({ platform }: { platform: Platform }) {
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
