// Fake stdio MCP server for tests. It has three tools and never touches the network.
// Usage: bun tests/support/fake-mcp.ts [--extra=<tool name>]... [--cwd]
// search and lookup say readOnlyHint true. delete_item says false. bad.name is not valid in a CLI flag. Each --extra adds a tool with no hint. --cwd adds cwd_probe: its description is JSON { cwd, entries } of the start folder.
import { readdirSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export const FAKE_MCP_TOOLS = [
  { name: "search", description: "Searches the fake index.", readOnlyHint: true },
  { name: "lookup", description: "Looks up one fake record.", readOnlyHint: true },
  { name: "delete_item", description: "Deletes one fake record.", readOnlyHint: false },
] as const;

if (import.meta.main) {
  const server = new McpServer({ name: "fake-mcp", version: "1.0.0" });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  for (const t of FAKE_MCP_TOOLS)
    server.registerTool(t.name, { description: t.description, annotations: { readOnlyHint: t.readOnlyHint } }, async () => text(t.name));
  server.registerTool("bad.name", { description: "A name with a dot." }, async () => text("bad"));
  for (const a of process.argv.slice(2))
    if (a.startsWith("--extra=")) server.registerTool(a.slice(8), { description: "An extra tool." }, async () => text("extra"));
  if (process.argv.includes("--cwd")) {
    const description = JSON.stringify({ cwd: process.cwd(), entries: readdirSync(process.cwd()).length });
    server.registerTool("cwd_probe", { description }, async () => text("cwd"));
  }
  await server.connect(new StdioServerTransport());
}
