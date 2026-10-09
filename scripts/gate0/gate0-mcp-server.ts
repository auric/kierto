// Gate 0 fixture: a minimal stdio MCP server with no tools.
// Usage: bun gate0-mcp-server.ts <pid-file>
// It ignores stdin EOF on purpose. It models a server that does not exit when its parent dies.
import { writeFileSync } from "node:fs";

writeFileSync(process.argv[2]!, `${process.pid} ${process.ppid}`);
setInterval(() => {}, 1 << 30);
process.stdout.on("error", () => {});

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined) continue;
    const result =
      msg.method === "initialize"
        ? { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "gate0", version: "0.0.0" } }
        : msg.method === "tools/list"
          ? { tools: [] }
          : {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
  }
});
