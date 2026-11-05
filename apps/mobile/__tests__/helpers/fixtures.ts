import { readFileSync } from "node:fs";
import { join } from "node:path";

// copies of @stamper/core test vectors and @stamper/minimise fixtures (stamper-protocol)
const root = join(__dirname, "../fixtures");
export const readFixture = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(join(root, rel)));
export const claimVectors = JSON.parse(readFileSync(join(root, "claims.json"), "utf8")) as {
  domain: { chainId: number; verifyingContract: `0x${string}` };
  claims: Array<{
    name: string;
    keyType: number;
    privateKey: `0x${string}`;
    keyInfo: { keyType: number; addr?: `0x${string}` };
    claim: Record<string, string | number>;
    digest: `0x${string}`;
    sig: `0x${string}`;
  }>;
};
