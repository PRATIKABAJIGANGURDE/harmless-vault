// Cross-platform (Windows / Linux / Termux) wrapper around `vite build` that
// targets a plain Node.js server, which is what the local SQLite + filesystem
// storage needs. Used by `npm run build:node`.
import { spawn } from "node:child_process";

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, VAULT_BUILD_TARGET: "node" },
    shell: process.platform === "win32",
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
