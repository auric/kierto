// Dev mode: Hono API with --watch and Vite with HMR share one session token.
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const VITE_PORT = 5173;
const env = {
  ...process.env,
  REVIEW_LOOP_SESSION: randomBytes(32).toString("hex"),
  REVIEW_LOOP_DEV_ORIGIN: `http://127.0.0.1:${VITE_PORT}`,
};

// Spawn the Vite entry with Bun directly. A .bin shim on Windows is a .cmd file, and a kill of the shim leaves Vite running.
const children = [
  Bun.spawn([process.execPath, "--watch", "src/server/main.ts"], { cwd: ROOT, env, stdio: ["inherit", "inherit", "inherit"] }),
  Bun.spawn([process.execPath, "node_modules/vite/bin/vite.js"], { cwd: ROOT, env, stdio: ["inherit", "inherit", "inherit"] }),
];

function stop(code: number) {
  for (const child of children) child.kill();
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
const first = await Promise.race(children.map((child) => child.exited));
stop(first);
