import { deploymentFor } from "@stamper/contracts-abi";
import { DEFAULT_ORIGIN, normaliseCode } from "@stamper/core";
import { type Address, getAddress, isAddress } from "viem";

export type WebChainId = 31337 | 314159 | 314;

export type Explorers = { blockscout?: string; filfox?: string; pdp?: string };

/**
 * A stamp featured on the landing page ("Or try an example"). `demo` marks a simulated-device stamp.
 * With `copy` set, the chip checks that file as a copy (the search finds the stamp) instead of opening it.
 */
export type Example = {
  code9: string;
  title: string;
  thumb: string | null;
  demo: boolean;
  copy: string | null;
};

export type WebConfig = {
  chainId: WebChainId;
  /** ≥ 2 in production; every chain read is made against each and compared. */
  rpcUrls: string[];
  registry: Address;
  resolver: Address | null;
  /** Presentation-only api; null disables it (verdicts never need it). */
  apiUrl: string | null;
  /** NEXT_PUBLIC_ORIGIN: the single public-origin constant of this runtime. */
  origin: string;
  verifyBase: string;
  filbeamBase: string | null;
  mirrorUrl: string | null;
  explorers: Explorers;
  examples: Example[];
};

export type RawEnv = Record<string, string | undefined>;

const CHAIN_IDS: readonly WebChainId[] = [31337, 314159, 314];

/** Public explorer bases per chain; NEXT_PUBLIC_EXPLORERS overrides per key. A local chain has none. */
const DEFAULT_EXPLORERS: Record<WebChainId, Explorers> = {
  31337: {},
  314159: {
    blockscout: "https://filecoin-testnet.blockscout.com",
    filfox: "https://calibration.filfox.info",
    pdp: "https://pdp.filecoin.cloud/calibration",
  },
  314: {
    blockscout: "https://filecoin.blockscout.com",
    filfox: "https://filfox.info",
    pdp: "https://pdp.filecoin.cloud/mainnet",
  },
};

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

function httpUrl(value: string, name: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: ${value}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`${name} must be http(s)`);
  return trimSlash(u.toString());
}

function optAddress(v: string | undefined, name: string): Address | null {
  if (!v) return null;
  if (!isAddress(v, { strict: false })) throw new Error(`${name} is not an address`);
  return getAddress(v);
}

/** `blockscout=https://…,filfox=https://…,pdp=https://…` */
export function parseExplorers(v: string | undefined): Explorers {
  const out: Explorers = {};
  for (const part of (v ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    const url = part.slice(i + 1).trim();
    if (key === "blockscout" || key === "filfox" || key === "pdp") out[key] = httpUrl(url, key);
  }
  return out;
}

const LOCAL_PATH = /^\/[A-Za-z0-9/_.-]+$/;

/**
 * `CODE|Title|/examples/thumb.jpg|demo|/examples/copy.jpg;CODE|Title` — thumb, the demo flag and the
 * copy file are optional.
 */
export function parseExamples(v: string | undefined): Example[] {
  const out: Example[] = [];
  for (const entry of (v ?? "").split(";")) {
    const [code, title, thumb, flag, copy] = entry.split("|").map((x) => x.trim());
    const n = code ? normaliseCode(code) : null;
    if (!n?.ok || !title) continue;
    out.push({
      code9: n.code9,
      title,
      thumb: thumb && LOCAL_PATH.test(thumb) ? thumb : null,
      demo: flag === "demo",
      copy: copy && LOCAL_PATH.test(copy) ? copy : null,
    });
  }
  return out;
}

/** Validates the NEXT_PUBLIC_* environment. Throws with the variable name on bad input. */
export function parseConfig(env: RawEnv): WebConfig {
  const chainId = Number(env.NEXT_PUBLIC_CHAIN_ID ?? "314159") as WebChainId;
  if (!CHAIN_IDS.includes(chainId)) throw new Error(`NEXT_PUBLIC_CHAIN_ID ${chainId} unsupported`);
  const rpcUrls = (env.NEXT_PUBLIC_RPC_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => httpUrl(u, "NEXT_PUBLIC_RPC_URLS"));
  let registry = optAddress(env.NEXT_PUBLIC_REGISTRY_ADDRESS, "NEXT_PUBLIC_REGISTRY_ADDRESS");
  let resolver = optAddress(env.NEXT_PUBLIC_RESOLVER_ADDRESS, "NEXT_PUBLIC_RESOLVER_ADDRESS");
  if (!registry) {
    try {
      const d = deploymentFor(chainId);
      registry = d.registry;
      if (!resolver && d.resolver !== "0x0000000000000000000000000000000000000000")
        resolver = d.resolver;
    } catch {
      registry = "0x0000000000000000000000000000000000000000";
    }
  }
  const origin = httpUrl(env.NEXT_PUBLIC_ORIGIN || DEFAULT_ORIGIN, "NEXT_PUBLIC_ORIGIN");
  const payer = optAddress(env.NEXT_PUBLIC_FILBEAM_PAYER, "NEXT_PUBLIC_FILBEAM_PAYER");
  const filbeamBase = env.NEXT_PUBLIC_FILBEAM_BASE
    ? httpUrl(env.NEXT_PUBLIC_FILBEAM_BASE, "NEXT_PUBLIC_FILBEAM_BASE")
    : payer
      ? `https://${payer.toLowerCase()}.${chainId === 314 ? "filbeam.io" : "calibration.filbeam.io"}`
      : null;
  return {
    chainId,
    rpcUrls,
    registry,
    resolver,
    apiUrl: env.NEXT_PUBLIC_API_URL
      ? httpUrl(env.NEXT_PUBLIC_API_URL, "NEXT_PUBLIC_API_URL")
      : null,
    origin,
    verifyBase: env.NEXT_PUBLIC_VERIFY_BASE_URL
      ? httpUrl(env.NEXT_PUBLIC_VERIFY_BASE_URL, "NEXT_PUBLIC_VERIFY_BASE_URL")
      : origin,
    filbeamBase,
    mirrorUrl: env.NEXT_PUBLIC_MIRROR_URL
      ? httpUrl(env.NEXT_PUBLIC_MIRROR_URL, "NEXT_PUBLIC_MIRROR_URL")
      : `${origin}/m`, // DESIGN §5.4: Stamper mirror at {origin}/m/{pieceCid}
    explorers: { ...DEFAULT_EXPLORERS[chainId], ...parseExplorers(env.NEXT_PUBLIC_EXPLORERS) },
    examples: parseExamples(env.NEXT_PUBLIC_EXAMPLES),
  };
}

let cached: WebConfig | null = null;

/** Literal `process.env.NEXT_PUBLIC_*` references so Next inlines them into the client bundle. */
export function getConfig(): WebConfig {
  cached ??= parseConfig({
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_RPC_URLS: process.env.NEXT_PUBLIC_RPC_URLS,
    NEXT_PUBLIC_REGISTRY_ADDRESS: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS,
    NEXT_PUBLIC_RESOLVER_ADDRESS: process.env.NEXT_PUBLIC_RESOLVER_ADDRESS,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_ORIGIN: process.env.NEXT_PUBLIC_ORIGIN,
    NEXT_PUBLIC_VERIFY_BASE_URL: process.env.NEXT_PUBLIC_VERIFY_BASE_URL,
    NEXT_PUBLIC_FILBEAM_PAYER: process.env.NEXT_PUBLIC_FILBEAM_PAYER,
    NEXT_PUBLIC_FILBEAM_BASE: process.env.NEXT_PUBLIC_FILBEAM_BASE,
    NEXT_PUBLIC_MIRROR_URL: process.env.NEXT_PUBLIC_MIRROR_URL,
    NEXT_PUBLIC_EXPLORERS: process.env.NEXT_PUBLIC_EXPLORERS,
    NEXT_PUBLIC_EXAMPLES: process.env.NEXT_PUBLIC_EXAMPLES,
  });
  return cached;
}
