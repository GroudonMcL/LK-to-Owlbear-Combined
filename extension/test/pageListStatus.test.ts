import { describe, expect, it } from "vitest";
import { describeStatus, timeAgo, type PageListStatus } from "../src/lib/pageLists";

const now = Date.UTC(2026, 9, 20, 12, 0, 0);
const status = (patch: Partial<PageListStatus>): PageListStatus => ({
  key: "gm/p",
  projectName: "D&D - Greyhawk",
  state: "ready",
  count: 13154,
  at: now,
  heartbeat: now,
  ...patch,
});

describe("page list status line", () => {
  it("says the project is loading, with progress once there is some", () => {
    expect(describeStatus(status({ state: "loading", count: 0 }), now)).toBe("D&D - Greyhawk: loading pages…");
    expect(describeStatus(status({ state: "loading", count: 4500 }), now)).toBe("D&D - Greyhawk: loading pages… 4,500 so far");
  });

  it("says how many pages and when", () => {
    expect(describeStatus(status({}), now)).toBe("D&D - Greyhawk: 13,154 pages, updated just now");
    expect(describeStatus(status({ count: 1, at: now - 5 * 60_000 }), now)).toBe("D&D - Greyhawk: 1 page, updated 5 minutes ago");
  });

  it("passes errors on", () => {
    expect(describeStatus(status({ state: "error", message: "Couldn't load LegendKeeper's page list: offline" }), now)).toBe(
      "D&D - Greyhawk: Couldn't load LegendKeeper's page list: offline",
    );
  });
});

describe("timeAgo", () => {
  it("rounds down to minutes, hours and days", () => {
    expect(timeAgo(now - 59_000, now)).toBe("just now");
    expect(timeAgo(now - 60_000, now)).toBe("1 minute ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2 days ago");
  });
});
