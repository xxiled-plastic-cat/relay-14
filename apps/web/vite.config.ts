import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const publishedDocs = [
  { source: "docs/exact-native.md", url: "/exact-native.md" },
  { source: "docs/prompts/resource-server.md", url: "/prompts/resource-server.md" },
  { source: "docs/prompts/payer.md", url: "/prompts/payer.md" },
] as const;

function publishDocs(): Plugin {
  const load = (source: string) => readFileSync(path.join(repoRoot, source));

  return {
    name: "publish-docs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        const match = publishedDocs.find((file) => file.url === url);
        if (!match) {
          next();
          return;
        }
        res.setHeader("content-type", "text/markdown; charset=utf-8");
        res.end(load(match.source));
      });
    },
    generateBundle() {
      for (const file of publishedDocs) {
        this.emitFile({
          type: "asset",
          fileName: file.url.slice(1),
          source: load(file.source),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), publishDocs()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
