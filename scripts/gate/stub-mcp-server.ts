// Gate B fixture: a stdio MCP server with one read-only tool, get_fact.
// Usage: bun stub-mcp-server.ts <calls-log-file> <fact>
// Each tools/call appends one JSON line to the log file. The server exits on stdin EOF.
import { appendFileSync, writeFileSync } from "node:fs";

const [, , log, fact] = process.argv;
if (!log || !fact) throw new Error("usage: bun stub-mcp-server.ts <calls-log-file> <fact>");
writeFileSync(log, "");

const tool = {
  name: "get_fact",
  description: "Returns the review fact for this run. Read-only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
};

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === undefined) continue;
    let result: unknown = {};
    if (msg.method === "initialize")
      result = {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "rl-stub", version: "0.0.0" },
      };
    else if (msg.method === "tools/list") result = { tools: [tool] };
    else if (msg.method === "tools/call") {
      appendFileSync(log, `${JSON.stringify({ tool: msg.params?.name, ts: Date.now() })}\n`);
      result =
        msg.params?.name === tool.name
          ? { content: [{ type: "text", text: fact }] }
          : { content: [{ type: "text", text: "unknown tool" }], isError: true };
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
  }
});
process.stdin.on("end", () => process.exit(0));
