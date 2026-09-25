import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Test files share one PostgreSQL database, and several of them assert on
    // global singleton rows (e.g. the PAYMENTS_ENABLED system setting, the
    // HUBTEL payment gateway config row). Running files in parallel let one
    // file's fixtures overwrite another's, producing order-dependent failures
    // that pass in isolation. Files run sequentially so the suite is
    // deterministic.
    fileParallelism: false,
  },
});
