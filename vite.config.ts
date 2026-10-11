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
    // React DOM goes to its own chunk, so the app chunk stays under the 500 kB warning.
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } },
  },
});
