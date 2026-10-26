import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The `@/` alias from tsconfig, so view tests can import the UI modules.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
