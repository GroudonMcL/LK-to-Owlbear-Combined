import { saveSettings, useSettings } from "../lib/settings";
import { Banner, Field, Segmented } from "../ui/components";

/** Where "Open LK Page" shows pages, for this person. A private project can only open in tabs. */
export function OpenModeField({ isPublic }: { isPublic: boolean | undefined }) {
  const settings = useSettings();
  const mode = isPublic === false ? "tab" : settings.openMode;
  return (
    <>
      <Field
        label="Open pages in"
        hint={
          mode === "panel"
            ? "A panel on the right of Owlbear, showing LegendKeeper's read-only public view."
            : "A new browser tab. The GM gets the full LegendKeeper app, to edit pages and read DM notes."
        }
      >
        <Segmented
          label="Open pages in"
          fill
          value={mode}
          onChange={(openMode) => saveSettings({ openMode })}
          options={[
            { value: "panel", label: "Owlbear panel" },
            { value: "tab", label: "New tab" },
          ]}
        />
      </Field>
      {isPublic === false && (
        <Banner tone="info">This project is private, so it has no public view to show in Owlbear. Pages open in a new tab, for LegendKeeper members of the project.</Banner>
      )}
    </>
  );
}
