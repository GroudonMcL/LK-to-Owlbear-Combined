import type { FinishStyle } from "./finishes";

// Token editor state. All lengths are fractions of the token's half-size R, so
// the same settings render identically at preview and export resolution.

export type ShapeId = "circle" | "rounded" | "square" | "hexagon" | "hexagonFlat";

/** "none", Stamped, or one of the finishes in finishes.ts. */
export type FrameStyle = "none" | "stamped" | FinishStyle;

export interface TokenStyle {
  shape: ShapeId;
  frame: FrameStyle;
  frameColor: string;
  /** Border thickness, fraction of R (0–0.25). */
  borderWidth: number;
  /** Gap between the canvas edge and the frame, fraction of R (0–0.2). */
  margin: number;
  /** Gap between the frame and the image, filled with the backing, fraction of R (0–0.2). */
  padding: number;
  backingColor: string;
  /** 0 = transparent backing. */
  backingOpacity: number;
  frameOpacity: number;
}

export interface ImageTransform {
  /** Multiplier on the scale that exactly covers the frame at 0°. */
  zoom: number;
  /** Image centre offset from the token centre, fractions of R. */
  offsetX: number;
  offsetY: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  /** Keep the image covering the frame (no empty corners). */
  lockFill: boolean;
}

export interface ImageAdjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  removeBackground: boolean;
  /** 0..100 colour distance tolerance for background removal. */
  backgroundTolerance: number;
}

export const DEFAULT_TRANSFORM: ImageTransform = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false,
  lockFill: false,
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  removeBackground: false,
  backgroundTolerance: 18,
};

export type FrameGroup = "Classic" | "Textures" | "Classes" | "Strange";

export interface FramePreset {
  id: string;
  name: string;
  group: FrameGroup;
  style: Pick<TokenStyle, "frame" | "frameColor" | "borderWidth" | "margin">;
}

/** Stamped's thickness, and room around it for its drop shadow. */
const BAND = { borderWidth: 0.14, margin: 0.1 };

function preset(id: string, name: string, group: FrameGroup, frame: FrameStyle, frameColor: string): FramePreset {
  return { id, name, group, style: { frame, frameColor, ...BAND } };
}

export const FRAME_PRESETS: FramePreset[] = [
  preset("stamped", "Stamped", "Classic", "stamped", "#d7671f"),
  preset("gilded", "Gilded", "Classic", "gilded", "#d4a64a"),
  preset("silver", "Silver", "Classic", "gilded", "#b8c2cf"),
  preset("engraved", "Engraved", "Classic", "engraved", "#7a7f8a"),
  preset("bronze", "Iron-bound", "Classic", "riveted", "#9a6a3c"),
  preset("forged", "Forged steel", "Classic", "hammered", "#7c8088"),
  preset("ember", "Ember gold", "Classic", "burnished", "#d7671f"),
  preset("arcane", "Arcane", "Classic", "arcane", "#6fc3ff"),
  preset("infernal", "Infernal", "Classic", "arcane", "#ff6a3d"),
  preset("double", "Double line", "Classic", "double", "#c9b27a"),
  preset("minimal", "Polished", "Classic", "line", "#8a8f99"),
  { id: "none", name: "No frame", group: "Classic", style: { frame: "none", frameColor: "#ffffff", borderWidth: 0, margin: 0 } },

  preset("oak", "Oak", "Textures", "wood", "#8a5a32"),
  preset("cobblestone", "Cobblestone", "Textures", "stone", "#8b8579"),
  preset("rope", "Rope", "Textures", "rope", "#b08a52"),
  preset("dragon-scale", "Dragon scale", "Textures", "scales", "#3f8a5a"),
  preset("vines", "Vines", "Textures", "vines", "#5f9a3a"),
  preset("frost", "Frost", "Textures", "frost", "#7fb8e0"),
  preset("magma", "Magma", "Textures", "magma", "#ff7a1a"),
  preset("harlequin", "Harlequin", "Textures", "harlequin", "#8c2f4a"),
  preset("knotwork", "Knotwork", "Textures", "braid", "#c9a24a"),
  preset("starfield", "Starfield", "Textures", "starfield", "#6a5ad8"),
  preset("ossuary", "Ossuary", "Textures", "bones", "#e2d6b8"),

  preset("barbarian", "Barbarian", "Classes", "claws", "#8a5a3a"),
  preset("bard", "Bard", "Classes", "notes", "#8e3b8f"),
  preset("cleric", "Cleric", "Classes", "radiant", "#e0b84a"),
  preset("druid", "Druid", "Classes", "vines", "#6aa83a"),
  preset("fighter", "Fighter", "Classes", "riveted", "#8c929c"),
  preset("monk", "Monk", "Classes", "beads", "#c4622c"),
  preset("paladin", "Paladin", "Classes", "holy", "#c9d2de"),
  preset("ranger", "Ranger", "Classes", "fletching", "#4f6b3a"),
  preset("rogue", "Rogue", "Classes", "stitched", "#4a3f3c"),
  preset("sorcerer", "Sorcerer", "Classes", "scales", "#b8322a"),
  preset("warlock", "Warlock", "Classes", "eyes", "#5b2d7a"),
  preset("wizard", "Wizard", "Classes", "arcane", "#3f6fd8"),
  preset("artificer", "Artificer", "Classes", "clockwork", "#b5813a"),

  preset("mimic", "Mimic", "Strange", "teeth", "#a8323c"),
  preset("beholder", "Beholder", "Strange", "beholder", "#7a3a5a"),
  preset("gelatinous", "Gelatinous", "Strange", "slime", "#7fc24a"),
  preset("candy", "Candy cane", "Strange", "candy", "#d6262e"),
];

export const FRAME_GROUPS: FrameGroup[] = ["Classic", "Textures", "Classes", "Strange"];

/** Every frame style there is, for checking saved settings. */
export const FRAME_STYLES = new Set<string>(["none", "stamped", ...FRAME_PRESETS.map((p) => p.style.frame)]);

export const DEFAULT_STYLE: TokenStyle = {
  shape: "circle",
  ...FRAME_PRESETS[0].style,
  padding: 0,
  backingColor: "#1d1f27",
  backingOpacity: 1,
  frameOpacity: 1,
};

export function effectiveShape(style: Pick<TokenStyle, "shape" | "frame">): ShapeId {
  return style.shape;
}

export const SHAPES: { id: ShapeId; name: string }[] = [
  { id: "circle", name: "Circle" },
  { id: "rounded", name: "Rounded" },
  { id: "square", name: "Square" },
  { id: "hexagon", name: "Hexagon" },
  { id: "hexagonFlat", name: "Flat hex" },
];

export const EXPORT_SIZES = [256, 512, 1024] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];

export const ZOOM_MAX = 8;
