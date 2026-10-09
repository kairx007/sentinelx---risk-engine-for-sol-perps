import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["apps/dashboard/**", "**/node_modules/**", "**/dist/**"],
  },
});
