// Builds the page into one self-contained HTML file: no requests at runtime.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
const src = fileURLToPath(new URL("./src", import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: "./",
  resolve: { alias: { "@": src } },
  server: { fs: { allow: [".."] } },
});
