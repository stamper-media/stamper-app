import { BANNED_WORDS, containsBannedWord, FOOTER, tierSentence } from "@stamper/core";
import { allCopyStrings } from "../lib/copy";

describe("copy table", () => {
  it("contains no banned word", () => {
    const strings = allCopyStrings();
    expect(strings.length).toBeGreaterThan(20);
    for (const s of strings) expect([s, containsBannedWord(s)]).toEqual([s, null]);
  });

  it("does not hard-code core copy (tier sentences and footer come from @stamper/core)", () => {
    const strings = allCopyStrings().join("\n");
    expect(strings.includes(FOOTER)).toBe(false);
    const t = tierSentence({
      level: 1,
      keyType: 0,
      countersigned: true,
      revokedBeforeStamp: false,
      registrarRemoved: false,
      offline: false,
      serverComputedCid: false,
    });
    expect(strings.includes(t.headline)).toBe(false);
    expect(BANNED_WORDS.length).toBeGreaterThan(0);
  });
});
