// Native modules are not available under jest; the libs take injectable adapters and the
// tests pass in-memory ones. crypto.getRandomValues comes from Node's webcrypto.
const { webcrypto } = require("node:crypto");
if (!globalThis.crypto?.getRandomValues) globalThis.crypto = webcrypto;
