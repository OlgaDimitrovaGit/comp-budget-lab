// Builds the page into one self-contained HTML file: no requests at runtime.
// The page was drafted as a TanStack route; shim.js stands in for the router (one page).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
const src = fileURLToPath(new URL("./src", import.meta.url));
const shim = fileURLToPath(new URL("./shim.js", import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: "./",
  resolve: { alias: { "@tanstack/react-router": shim, "@": src } },
  server: { fs: { allow: [".."] } },
});
