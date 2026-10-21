import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The report contract lives in the backend; the UI imports its types only (erased at build time).
const contract = fileURLToPath(new URL("../backend/src/contract", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@contract$/, replacement: `${contract}/index.ts` },
      { find: /^@contract\//, replacement: `${contract}/` },
    ],
  },
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
  },
});
