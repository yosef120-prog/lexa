import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // The published site sits at yosef120-prog.github.io/lexa/, not at a root, so
  // Vite has to write asset URLs the browser can actually find. Local
  // development stays at the root, where it belongs.
  base: process.env.GITHUB_ACTIONS ? "/lexa/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5175 },
});
