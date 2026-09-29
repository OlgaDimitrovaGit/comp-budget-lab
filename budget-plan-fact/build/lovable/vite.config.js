import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Library build: one IIFE script (the chart, exposed as window.BPChart) and
// one CSS file, both inlined into the page by build.py.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "dist", emptyOutDir: true, cssCodeSplit: false, minify: true,
    lib: { entry: "entry.js", formats: ["iife"], name: "BPBundle", fileName: () => "chart.js" },
  },
});
