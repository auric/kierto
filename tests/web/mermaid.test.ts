// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// src/web/explain/mermaid.ts: the checks before mermaid runs, and the fallback when it fails. A fake replaces the mermaid module.
import { expect, mock, test } from "bun:test";
import { firstErrorLine, MAX_DIAGRAM_CHARS, prepare, renderDiagram } from "../../src/web/explain/mermaid";

const configs: Record<string, unknown>[] = [];
const events: string[] = [];
const tick = () => new Promise((r) => setTimeout(r, 5));
mock.module("mermaid", () => ({
  default: {
    initialize: (c: Record<string, unknown>) => {
      configs.push(c);
      events.push("init");
    },
    parse: async (code: string) => {
      events.push(`parse ${code.split("\n")[1]}`);
      await tick();
      if (code.includes("bad")) throw new Error("Parse error on line 2:\nA-->\n----^\nExpecting 'NODE_STRING'");
      return { diagramType: code.includes("swimlane") ? "swimlane" : "flowchart-v2" };
    },
    render: async (id: string) => {
      events.push("render");
      await tick();
      return { svg: `<svg id="${id}"><text>a & b</text></svg>` };
    },
  },
}));

// renderDiagram removes the scratch nodes from the document. This stub records the IDs.
async function withDocument<T>(fn: (removed: string[]) => Promise<T>): Promise<T> {
  const g = globalThis as { document?: unknown };
  const before = g.document;
  const removed: string[] = [];
  g.document = { getElementById: (id: string) => ({ remove: () => removed.push(id) }) };
  try {
    return await fn(removed);
  } finally {
    g.document = before;
  }
}

test("prepare drops every line with a %%{ directive and takes the title from the first diagram line", () => {
  const r = prepare('%%{init: {"theme": "dark"}}%%\n%% a comment\nflowchart TD\n  A --> B %%{init: {}}%%\n  B --> C\n');
  expect(r).toEqual({ ok: true, code: "%% a comment\nflowchart TD\n  B --> C\n", title: "flowchart TD" });
  if (r.ok) expect(r.code).not.toContain("%%{");
});

test("prepare allows only flowchart, graph, sequenceDiagram, and classDiagram", () => {
  for (const code of [
    "flowchart LR\nA-->B",
    "graph TD\nA-->B",
    "  graph\nA-->B",
    "sequenceDiagram\nA->>B: hi",
    "classDiagram\nclass A",
    "graph TD;A-->B",
  ])
    expect(prepare(code).ok).toBe(true);
  for (const code of [
    'pie\n"a": 1',
    "flowchart-elk TD\nA-->B",
    "classDiagram-v2\nclass A",
    "stateDiagram-v2\n[*] --> A",
    "graphTD\nA-->B",
    "---\nconfig:\n  htmlLabels: true\n---\nflowchart TD\nA-->B",
    "%% only a comment",
    "",
  ])
    expect(prepare(code)).toEqual({ ok: false, reason: "type" });
});

test("prepare refuses code over 20,000 characters", () => {
  const head = "flowchart TD\n";
  const fits = head + "A".repeat(MAX_DIAGRAM_CHARS - head.length);
  expect(prepare(fits).ok).toBe(true);
  expect(prepare(`${fits}B`)).toEqual({ ok: false, reason: "long" });
  // The directive lines leave before the size check.
  expect(prepare(`%%{init: {}}%%\n${fits}`).ok).toBe(true);
});

test("firstErrorLine gives the first non-empty line of an error", () => {
  expect(firstErrorLine(new Error("\n  Parse error on line 2:\nA-->\n"))).toBe("Parse error on line 2:");
  expect(firstErrorLine("Lexical error")).toBe("Lexical error");
  expect(firstErrorLine(new Error(""))).toBe("Unknown error.");
  expect(firstErrorLine(new Error("x".repeat(400)))).toHaveLength(300);
});

test("renderDiagram gives a data URL image with the strict config and removes the scratch nodes", async () => {
  const r = await withDocument(async (removed) => {
    const out = await renderDiagram("flowchart TD\nA-->B", { primaryColor: "#edf0f4", darkMode: false });
    expect(removed).toHaveLength(2);
    expect(removed[1]).toBe(`d${removed[0]}`);
    return out;
  });
  expect(r).toEqual({
    ok: true,
    src: "data:image/svg+xml;charset=utf-8,%3Csvg%20id%3D%22rl-mmd-1%22%3E%3Ctext%3Ea%20%26%20b%3C%2Ftext%3E%3C%2Fsvg%3E",
  });
  expect(configs.at(-1)).toMatchObject({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    layout: "dagre",
    look: "classic",
    theme: "base",
    themeVariables: { primaryColor: "#edf0f4", darkMode: false },
    maxTextSize: MAX_DIAGRAM_CHARS,
    maxEdges: 300,
  });
});

test("a parse error gives the first error line and never throws, and the scratch nodes leave", async () => {
  const r = await withDocument(async (removed) => {
    const out = await renderDiagram("flowchart TD\nA--> bad", {});
    expect(removed).toHaveLength(2);
    return out;
  });
  expect(r).toEqual({ ok: false, error: "Parse error on line 2:" });
});

test("a diagram type that mermaid detects outside the allowed set does not render", async () => {
  const r = await withDocument(async () => renderDiagram("flowchart TD\nswimlane", {}));
  expect(r).toEqual({ ok: false, error: "The diagram type swimlane does not render here." });
});

test("renders run one at a time in call order, also after a failed one", async () => {
  events.length = 0;
  const all = await withDocument(async () =>
    Promise.all([renderDiagram("graph TD\nA-->B", {}), renderDiagram("graph TD\nbad", {}), renderDiagram("graph TD\nC-->D", {})]),
  );
  expect(all.map((r) => r.ok)).toEqual([true, false, true]);
  expect(events).toEqual(["init", "parse A-->B", "render", "init", "parse bad", "init", "parse C-->D", "render"]);
});
