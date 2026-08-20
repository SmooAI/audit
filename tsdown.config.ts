import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/schema.ts",
    "src/canonical.ts",
    "src/hash.ts",
    "src/client.ts",
    "src/envelope.ts",
  ],
  clean: true,
  dts: true,
  format: ["cjs", "esm"],
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
