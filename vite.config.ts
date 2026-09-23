// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The vault server stores data with node:sqlite and the local filesystem, so a
// self-hosted build (Windows, a Linux box, Termux on the Narzo 50A) must target
// Node. `npm run build:node` sets this; the default stays unchanged.
const preset = process.env["VAULT_BUILD_TARGET"] === "node" ? "node-server" : "cloudflare-module";

export default defineConfig({
  nitro: { preset },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
