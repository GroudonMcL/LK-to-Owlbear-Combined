import type { ReactNode } from "react";

const PALETTE = ["#8a5a44", "#4f6d8f", "#5f7d4f", "#7c5a8c", "#8f6e3a", "#3f7a7a", "#8c4f5f", "#5a5f8c"];

/** The page's LegendKeeper icon colour, or a stable colour picked from its name. */
export function colorFor(page: { name: string; iconColor?: string | null }): string {
  if (page.iconColor && /^#[0-9a-f]{6}$/i.test(page.iconColor)) return page.iconColor;
  let h = 0;
  for (const ch of page.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initial(name: string): string {
  return (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

/** One page in a result list: icon tile, name, folder path, then any extra lines and badges. */
export function PageRow({
  name,
  path,
  iconColor,
  active,
  index,
  details,
  meta,
  onClick,
  onHover,
}: {
  name: string;
  path: string[];
  iconColor?: string | null;
  active: boolean;
  index: number;
  details?: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      className="result"
      role="option"
      aria-selected={active}
      style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <span className="result-icon" style={{ background: colorFor({ name, iconColor }) }}>
        {initial(name)}
      </span>
      <span className="result-main">
        <span className="result-name">{name}</span>
        {path.length > 0 && <span className="result-path">{path.join(" › ")}</span>}
        {details}
      </span>
      {meta && <span className="result-meta">{meta}</span>}
    </button>
  );
}
