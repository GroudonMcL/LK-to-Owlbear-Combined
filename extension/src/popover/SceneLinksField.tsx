import { saveSceneLinkSettings, useSceneLinkSettings } from "../lib/sceneLinkSettings";

/** The switch for page names linked right in the scene's notes and Text items. */
export function SceneLinksField({ role }: { role: "GM" | "PLAYER" }) {
  const { enabled } = useSceneLinkSettings();
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => saveSceneLinkSettings({ enabled: e.target.checked })} />
        {role === "GM" ? "Underline page names in notes and text, and open them on click" : "Open page names in notes and text on click"}
      </label>
      <div className="field-hint">
        {role === "GM"
          ? "Public pages are underlined in the notes' own text, so players see the underlines too. Turning this off takes the underlines off again."
          : "Click an underlined page name in a note or Text item to read its page."}
      </div>
    </div>
  );
}
