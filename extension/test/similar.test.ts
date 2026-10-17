import { describe, expect, it } from "vitest";
import { createLink, LINK_KEY } from "../src/lib/links";
import { findSimilarTokens, nameWords, similarNames } from "../src/lib/similar";

describe("similar names", () => {
  it.each([
    ["Tiamat", "Tiamat (God Template clip)"],
    ["goblin", "Goblin Boss"],
    ["Iggwilv", "iggwilv"],
    ["Tiamet", "Tiamat"],
    ["Lord_Soth.png", "Lord Soth"],
    ["Mordrith the Cruel", "Mordrith"],
    ["Élan", "Elan"],
  ])("%s ~ %s", (a, b) => expect(similarNames(a, b)).toBe(true));

  it.each([
    ["Orc", "Goblin Boss"],
    ["token-07.png", "Goblin Boss"],
    ["Bo", "Bo Peep"],
    ["Goblin King", "Goblin Boss"],
    ["", "Goblin"],
  ])("%s ≁ %s", (a, b) => expect(similarNames(a, b)).toBe(false));

  it("drops extensions, numbers and filler words", () => {
    expect(nameWords("The_Hollow-Queen 02.png")).toEqual(["hollow", "queen"]);
  });
});

describe("findSimilarTokens", () => {
  const t = (id: string, name: string, label = "", metadata: Record<string, unknown> = {}) => ({ id, name, label, metadata });

  it("finds unlinked tokens by label or name, exact matches first", () => {
    const tokens = [
      t("a", "token-01.png", "Tiamat"),
      t("b", "Tiamat (God Template clip)"),
      t("c", "orc.png", "Orc"),
      t("d", "Tiamat", "", { [LINK_KEY]: createLink("p", "r", "Tiamat", "") }),
    ];
    expect(findSimilarTokens(tokens, ["Tiamat (God Template clip)"])).toEqual([
      { id: "b", matched: "Tiamat (God Template clip)" },
      { id: "a", matched: "Tiamat" },
    ]);
  });

  it("matches page aliases", () => {
    expect(findSimilarTokens([t("a", "x.png", "Queen of Dragons")], ["Tiamat", "Queen of Dragons"])).toEqual([{ id: "a", matched: "Queen of Dragons" }]);
  });
});
