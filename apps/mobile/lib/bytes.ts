/** Pure base64 helpers (Hermes has no Buffer; atob/btoa work on strings, not bytes). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += b === undefined ? "=" : ALPHABET[(n >> 6) & 63];
    out += c === undefined ? "=" : ALPHABET[n & 63];
  }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (s.length % 4 === 1) throw new TypeError("invalid base64 length");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (const ch of s) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new TypeError("invalid base64 character");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
