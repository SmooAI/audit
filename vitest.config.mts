import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // No passWithNoTests: this repo HAS TS tests, so an empty run means the
    // glob or the config broke — that must be red, not a silent green.
    env: {
      FORCE_COLOR: "1",
    },
  },
});
