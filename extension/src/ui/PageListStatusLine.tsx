// "D&D - Greyhawk: loading pages…" / "D&D - Greyhawk: 13,154 pages, updated just now"

import { describeStatus, usePageListStatus } from "../lib/pageLists";
import { Spinner } from "./components";

export function PageListStatusLine({ listKey }: { listKey: string }) {
  const status = usePageListStatus();
  if (!status || status.key !== listKey) return null;
  const tone = status.state === "error" ? "var(--danger)" : undefined;
  return (
    <div className="row small muted" role="status" aria-live="polite" style={{ gap: 6, color: tone }}>
      {status.state === "loading" && <Spinner />}
      <span>{describeStatus(status)}</span>
    </div>
  );
}
