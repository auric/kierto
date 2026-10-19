// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Gate 0: store the Bitbucket base URL and HTTP access token in the OS credential store.
// Usage: bun scripts/gate0/set-token.ts [--check | --clear]
import { createInterface } from "node:readline/promises";

const SERVICE = "review-loop";
const URL_NAME = "bitbucket-url";
const TOKEN_NAME = "bitbucket-token";

const arg = process.argv[2];

if (arg === "--check") {
  const missing = [];
  if (!(await Bun.secrets.get({ service: SERVICE, name: URL_NAME }))) missing.push(URL_NAME);
  if (!(await Bun.secrets.get({ service: SERVICE, name: TOKEN_NAME }))) missing.push(TOKEN_NAME);
  console.log(missing.length ? `missing: ${missing.join(", ")}` : "ok");
  process.exit(missing.length ? 1 : 0);
}

if (arg === "--clear") {
  await Bun.secrets.delete({ service: SERVICE, name: URL_NAME });
  await Bun.secrets.delete({ service: SERVICE, name: TOKEN_NAME });
  console.log("cleared");
  process.exit(0);
}

if (arg !== undefined) {
  console.error("usage: bun scripts/gate0/set-token.ts [--check | --clear]");
  process.exit(2);
}

if (!process.stdin.isTTY) {
  console.error("Run this script in an interactive terminal. The token input must be hidden.");
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const rawUrl = (await rl.question("Bitbucket base URL: ")).trim();
rl.close();

let baseUrl: string;
try {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
  if (u.username || u.password || u.search || u.hash) throw new Error("extra parts");
  baseUrl = (u.origin + u.pathname).replace(/\/+$/, "");
} catch {
  console.error("Invalid URL. Give the base URL only, for example https://host or https://host/context.");
  process.exit(2);
}

const token = await readHidden("HTTP access token (hidden): ");
if (!token) {
  console.error("Empty token. Nothing stored.");
  process.exit(2);
}

await Bun.secrets.set({ service: SERVICE, name: URL_NAME, value: baseUrl });
await Bun.secrets.set({ service: SERVICE, name: TOKEN_NAME, value: token });
console.log("stored");
process.exit(0);

function readHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value.trim());
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\b" || ch === "\u007f") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
