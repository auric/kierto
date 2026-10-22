// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Mermaid diagrams in Markdown (plan review-v2 spec 3.5). The SVG shows in an <img>, so no diagram script runs and the CSP needs no change.
// Keep this module free of DOM access at import time: the unit tests import it without a DOM.

export const MAX_DIAGRAM_CHARS = 20_000;
// The first keyword of the three allowed types, and the IDs that mermaid.parse gives for them (mermaid 12.1.0 detectors).
const KINDS = /^\s*(flowchart|graph|sequenceDiagram|classDiagram)(\s|$)/;
const TYPES = new Set(["flowchart-v2", "sequence", "classDiagram"]);

export type Prepared = { ok: true; code: string; title: string } | { ok: false; reason: "long" | "type" };
export type Rendered = { ok: true; src: string } | { ok: false; error: string };

// A %%{ directive and YAML front matter (---) can change the config. No line with %%{ reaches mermaid, and front matter fails the type check.
export function prepare(raw: string): Prepared {
  const code = raw
    .split("\n")
    .filter((l) => !l.includes("%%{"))
    .join("\n");
  if (code.length > MAX_DIAGRAM_CHARS) return { ok: false, reason: "long" };
  const first = code.split("\n").find((l) => l.trim() !== "" && !l.trimStart().startsWith("%%"));
  return first && KINDS.test(first) ? { ok: true, code, title: first.trim() } : { ok: false, reason: "type" };
}

export function firstErrorLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean)
      ?.slice(0, 300) ?? "Unknown error."
  );
}

// The index.css tokens are hex colors, which mermaid's color library reads. An <img> SVG gets no web font, and the app uses system fonts.
export function themeVariables(dark: boolean): Record<string, string | boolean> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    darkMode: dark,
    background: v("--pane"),
    fontFamily: v("--font-sans") || "sans-serif",
    fontSize: "14px",
    primaryColor: v("--sunken"),
    primaryTextColor: v("--foreground"),
    primaryBorderColor: v("--rule-strong"),
    secondaryColor: v("--sel"),
    tertiaryColor: v("--pane-2"),
    lineColor: v("--ink-2"),
    textColor: v("--foreground"),
    mainBkg: v("--sunken"),
    noteBkgColor: v("--sel"),
    noteTextColor: v("--foreground"),
    noteBorderColor: v("--rule-strong"),
  };
}

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

// One render at a time: mermaid keeps one global config. Never rejects.
export function renderDiagram(code: string, vars: Record<string, string | boolean>): Promise<Rendered> {
  const run = queue.then(() => draw(code, vars));
  queue = run;
  return run;
}

async function draw(code: string, themeVariables: Record<string, string | boolean>): Promise<Rendered> {
  const id = `rl-mmd-${++seq}`;
  try {
    const { default: mermaid } = await import("mermaid");
    // useMaxWidth false gives the SVG its own width and height, so a small diagram does not grow to the text width.
    // Mermaid 12 defaults to the ELK layout and gives each diagram type its own theme and look. Top-level values win over them.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      class: { useMaxWidth: false },
      // The class renderer of mermaid 12.1.0 (classRenderer-v3-unified.ts) reads useMaxWidth from the state config.
      state: { useMaxWidth: false },
      layout: "dagre",
      look: "classic",
      theme: "base",
      themeVariables,
      maxTextSize: MAX_DIAGRAM_CHARS,
      maxEdges: 300,
    });
    const { diagramType } = await mermaid.parse(code);
    if (!TYPES.has(diagramType)) return { ok: false, error: `The diagram type ${diagramType} does not render here.` };
    const { svg } = await mermaid.render(id, code);
    return { ok: true, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
  } catch (e) {
    return { ok: false, error: firstErrorLine(e) };
  } finally {
    // After an error, render can leave its scratch nodes in the body.
    for (const n of [id, `d${id}`]) document.getElementById(n)?.remove();
  }
}
