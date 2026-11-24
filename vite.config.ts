import {defineConfig} from "vite";

// verity.wasm is built by `npm run asbuild` into public/, so it is copied to dist/ next to index.html.
export default defineConfig({
  base: "./",
  worker: {format: "es"},
  build: {target: "es2022"},
});
