import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** WP-14 tests: `pnpm --filter @stamper/web exec vitest run --config app/capture/vitest.config.ts`. */
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: { include: ["app/capture/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
