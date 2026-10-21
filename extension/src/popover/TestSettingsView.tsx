// Test settings for links on the map: page names in notes and Text items,
// underlined and clickable. Each person's own, kept in this browser.

import { RotateCcw } from "lucide-react";
import { resetSceneLinkSettings, saveSceneLinkSettings, useSceneLinkSettings, type UnderlineStyle } from "../lib/sceneLinkSettings";
import { Banner, Button, Field, Segmented, Slider } from "../ui/components";

export function TestSettingsView({ role }: { role: "GM" | "PLAYER" }) {
  const s = useSceneLinkSettings();
  const update = saveSceneLinkSettings;
  // Real underlines are written by the GM's browser; a player picking them would see nothing.
  const underline: UnderlineStyle = role === "PLAYER" && s.underline === "rich" ? "overlay" : s.underline;
  const underlineOptions: { value: UnderlineStyle; label: string }[] = [
    { value: "overlay", label: "Drawn over" },
    ...(role === "GM" ? [{ value: "rich" as const, label: "Real underline" }] : []),
    { value: "none", label: "None" },
  ];
  const usesLayout = s.enabled && (underline === "overlay" || s.clickWords);

  return (
    <div className="stack">
      <section className="card stack">
        <div className="eyebrow">Links on the map</div>
        <label className="check">
          <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          Mark page names in notes and Text items
        </label>
        {s.enabled && (
          <>
            <Field
              label="Underline"
              hint={
                underline === "overlay"
                  ? "Lines drawn over the words, only in your browser. Each person sees the pages they can open."
                  : underline === "rich"
                    ? "Underlines written into the notes' own text, so everyone sees them. Public pages only. Switch away to take them off again."
                    : "No underlines."
              }
            >
              <Segmented label="Underline" fill value={underline} onChange={(u) => update({ underline: u })} options={underlineOptions} />
            </Field>
            {role === "PLAYER" && (
              <div className="field-hint">If the GM turns on real underlines, you see those as well; yours aren't drawn twice.</div>
            )}
            <label className="check">
              <input type="checkbox" checked={s.clickWords} onChange={(e) => update({ clickWords: e.target.checked })} />
              Click a linked word to open its page (option B)
            </label>
            <label className="check">
              <input type="checkbox" checked={s.badge} onChange={(e) => update({ badge: e.target.checked })} />
              Book badge on each note or text that names pages (option C)
            </label>
          </>
        )}
      </section>

      {s.enabled && underline === "overlay" && (
        <section className="card stack">
          <div className="eyebrow">Drawn underline</div>
          <Field label="Colour">
            <input type="color" value={s.color} onChange={(e) => update({ color: e.target.value })} />
          </Field>
          <Slider label="Opacity" min={0.1} max={1} step={0.05} value={s.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => update({ opacity })} />
          <Slider label="Thickness" min={0.02} max={0.2} step={0.01} value={s.thickness} format={(v) => `${v.toFixed(2)} em`} onChange={(thickness) => update({ thickness })} />
          <Slider label="Height" min={-0.5} max={0.5} step={0.01} value={s.offset} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} em`} onChange={(offset) => update({ offset })} />
        </section>
      )}

      {usesLayout && (
        <section className="card stack">
          <div className="eyebrow">Line-up</div>
          <div className="field-hint">
            Owlbear doesn't say where it draws each word, so the extension works it out. If the lines or click areas sit off the words,
            turn on the click areas and adjust these.
          </div>
          <label className="check">
            <input type="checkbox" checked={s.showBoxes} onChange={(e) => update({ showBoxes: e.target.checked })} />
            Show click areas
          </label>
          <Slider label="Text size" min={0.5} max={2} step={0.01} value={s.textScale} format={(v) => `${Math.round(v * 100)}%`} onChange={(textScale) => update({ textScale })} />
          <Slider label="Heading 1" min={1} max={3} step={0.05} value={s.heading1} format={(v) => `×${v.toFixed(2)}`} onChange={(heading1) => update({ heading1 })} />
          <Slider label="Heading 2" min={1} max={3} step={0.05} value={s.heading2} format={(v) => `×${v.toFixed(2)}`} onChange={(heading2) => update({ heading2 })} />
          <Slider label="List indent" min={0} max={4} step={0.1} value={s.listIndent} format={(v) => `${v.toFixed(1)} em`} onChange={(listIndent) => update({ listIndent })} />
          <Slider label="Paragraph gap" min={0} max={2} step={0.05} value={s.paragraphGap} format={(v) => `${v.toFixed(2)} em`} onChange={(paragraphGap) => update({ paragraphGap })} />
        </section>
      )}

      {s.enabled && s.clickWords && (
        <Banner tone="info">
          Clicking a word selects an invisible box over it, which the extension notices and clears. Double-click elsewhere in the note to edit
          it. Rotated notes and text get the badge only.
        </Banner>
      )}

      <Button icon={<RotateCcw />} onClick={() => resetSceneLinkSettings()}>
        Reset test settings
      </Button>
    </div>
  );
}
