// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const apiPort = Number(process.env.REVIEW_LOOP_PORT ?? 7317);

// Dev only. A build keeps the placeholder, and the server replaces it at request time.
// The placeholder must equal TOKEN_PLACEHOLDER in src/server/app.ts. An import from there makes Vite warn about extensionless imports.
const devSessionToken: Plugin = {
  name: "review-loop-dev-session",
  apply: "serve",
  transformIndexHtml: (html) => html.replaceAll("__RL_SESSION__", process.env.REVIEW_LOOP_SESSION ?? ""),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), devSessionToken],
  resolve: { alias: { "@": fileURLToPath(new URL("./src/web", import.meta.url)) } },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    // React DOM and the other start-up libraries get their own chunks, so each chunk stays under the 500 kB warning.
    // "vendor" names only packages of the first page. A wider test would move the Markdown libraries into the first load.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/](@base-ui|@floating-ui|@tanstack|zod|cn|lucide-react|hono)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } },
  },
});
