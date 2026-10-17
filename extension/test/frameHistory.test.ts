import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  frameLoaded,
  INITIAL_FRAME_HISTORY,
  lengthChanged,
  wentBack,
  wentForward,
  type FrameHistory,
} from "../src/panel/frameHistory";

/** A model of the browser's joint session history, with Owlbear's own entries first. */
class Browser {
  entries = 5; // Owlbear's entries
  index = 4;
  get length() {
    return this.entries;
  }
  navigate() {
    this.entries = this.index + 2;
    this.index++;
  }
  back() {
    if (this.index > 0) this.index--;
  }
  forward() {
    if (this.index < this.entries - 1) this.index++;
  }
}

describe("frame history", () => {
  it("is disabled until the frame loads", () => {
    expect(canGoBack(INITIAL_FRAME_HISTORY)).toBe(false);
    expect(canGoForward(INITIAL_FRAME_HISTORY)).toBe(false);
  });

  it("steps back and forward through the frame's own pages", () => {
    const b = new Browser();
    let h = frameLoaded(INITIAL_FRAME_HISTORY, b.length);
    b.navigate();
    h = lengthChanged(h, b.length);
    b.navigate();
    h = lengthChanged(h, b.length);
    expect(h.pos).toBe(2);
    expect(canGoForward(h)).toBe(false);
    h = wentBack(h);
    h = wentBack(h);
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(true);
    h = wentForward(h);
    expect(h.pos).toBe(1);
  });

  it("never steps back past the frame's first page, whatever the user does", () => {
    // Random walks: the tracked position must never exceed the true one.
    for (let run = 0; run < 500; run++) {
      const b = new Browser();
      const first = b.index;
      let h: FrameHistory = frameLoaded(INITIAL_FRAME_HISTORY, b.length);
      for (let step = 0; step < 40; step++) {
        const r = Math.random();
        if (r < 0.4) b.navigate();
        else if (r < 0.7 && canGoBack(h)) {
          b.back();
          h = wentBack(h);
        } else if (canGoForward(h)) {
          b.forward();
          h = wentForward(h);
        }
        h = lengthChanged(h, b.length);
        expect(h.pos).toBeLessThanOrEqual(b.index - first);
        expect(b.index).toBeGreaterThanOrEqual(first);
      }
    }
  });
});
