/**
 * Hermes/Metro smoke: imports @stamper/core and @stamper/minimise through the jest-expo
 * (react-native) resolver and runs predictCode + pieceCidOf on 1 MiB with both implementations.
 * Timings here are Node/JSC-in-jest timings, not Hermes-on-device (see spikes/hermes-piece.md).
 */
import * as core from "@stamper/core";
import * as minimise from "@stamper/minimise";

describe("hermes-smoke", () => {
  it("resolves the pure packages through the react-native resolver", () => {
    expect(typeof core.predictCode).toBe("function");
    expect(typeof core.pieceCidOf).toBe("function");
    expect(typeof minimise.minimiseJpeg).toBe("function");
    expect(minimise.STREAM_THRESHOLD).toBe(64 * 1024 * 1024);
  });

  it("predictCode matches the frozen code vectors", () => {
    const fmt = (id: `0x${string}`) => {
      const p = core.predictCode(id);
      return [core.formatCode(core.encodeCode(p.code)), p.attempt];
    };
    expect(fmt(`0x${"11".repeat(32)}`)).toEqual(["5VEB-TVRA-F", 0]);
    expect(fmt(`0x${"ab".repeat(32)}`)).toEqual(["MR58-TTN8-D", 1]);
    expect(fmt(`0x${"07".repeat(32)}`)).toEqual(["6NJ9-RNXC-P", 0]);
    expect(fmt(`0x${"c3".repeat(32)}`)).toEqual(["W0SB-9TAX-B", 0]);
  });

  it("pieceCidOf(1 MiB) agrees between synapse and fr32", async () => {
    const bytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const t0 = Date.now();
    const a = await core.pieceCidOf(bytes, { impl: "synapse" });
    const t1 = Date.now();
    const b = await core.pieceCidOf(bytes, { impl: "fr32" });
    const t2 = Date.now();
    expect(core.pieceCidString(a)).toBe(core.pieceCidString(b));
    expect(core.pieceCidString(a)).toMatch(/^bafkzcib/);
    // eslint-disable-next-line no-console
    console.log(`jest pieceCidOf 1 MiB: synapse ${t1 - t0} ms, fr32 ${t2 - t1} ms`);
  });
});
