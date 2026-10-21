// Frames painted from artwork rather than drawn: a ring image with its own
// gradient, texture and shadow. They are circles of a fixed thickness; the
// image is scaled to the frame's outer edge.

import type { FrameStyle } from "./model";

export type ImageFrameStyle = "stampedColour" | "stampedGrey";

const URLS: Record<ImageFrameStyle, string> = {
  stampedColour: "frames/stamped-colour.webp",
  stampedGrey: "frames/stamped-grey.webp",
};

/**
 * Where to clip the art, as a fraction of the frame's outer radius: under the
 * opaque ring all the way round (the rings' inner edges lie at 0.82–0.85 and
 * their outer edges at 0.95 or more), so no seam shows.
 */
export const IMAGE_FRAME_CLIP = 0.9;

const images = new Map<ImageFrameStyle, CanvasImageSource>();

export function isImageFrame(style: FrameStyle): style is ImageFrameStyle {
  return style in URLS;
}

export function frameImage(style: ImageFrameStyle): CanvasImageSource | undefined {
  return images.get(style);
}

/** Sets a frame's image directly (tests, where there is no page to load it from). */
export function setFrameImage(style: ImageFrameStyle, image: CanvasImageSource): void {
  images.set(style, image);
}

/** Loads every frame image, so rendering (which is synchronous) can draw them. A failed one is skipped. */
export function preloadFrameImages(): Promise<void> {
  return Promise.all(
    (Object.keys(URLS) as ImageFrameStyle[]).map(
      (style) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            images.set(style, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = new URL(URLS[style], location.href).toString();
        }),
    ),
  ).then(() => undefined);
}
