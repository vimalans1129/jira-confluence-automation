import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Database tests share one PostgreSQL instance and reset the same tables.
    fileParallelism: false,
  },
});
