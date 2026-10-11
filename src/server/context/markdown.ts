// Jira rendered HTML to Markdown (plan r3 S-JMD). The HTML is untrusted. domino parses it and runs no script and loads no resource.
import TurndownService from "turndown";

// Removed with all content.
const REMOVE = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "noscript",
  "template",
  "svg",
  "math",
  "video",
  "audio",
  "canvas",
  "link",
  "meta",
  "base",
]);
const SECTIONS = new Set(["THEAD", "TBODY", "TFOOT"]);
const CELLS = new Set(["TH", "TD"]);
// The path after the Jira base. Group 1: the attachment ID.
const ATTACHMENT_PATH = /^secure\/(?:attachment|thumbnail)\/([0-9]{1,18})\//;

// The image token of an attachment. Group 1: the escaped name, group 2: the attachment ID.
export const ATTACHMENT_IMAGE = /!\[((?:\\.|[^\\\]])*)\]\(attachment:([0-9]{1,18})\)/g;

// A fenced code block. The fence is longer than every backtick run in the text (CommonMark 4.5).
export function fenced(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text.replace(/\r\n?/g, "\n").replace(/\n$/, "")}\n${fence}`;
}

const elements = (node: Element) => Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);

// GFM table. A first row without a header cell gets an empty header row, because GFM needs one.
function table(node: Element, cells: WeakMap<Node, string>): string {
  const rows: Element[] = [];
  for (const part of elements(node)) {
    if (part.nodeName === "TR") rows.push(part);
    else if (SECTIONS.has(part.nodeName)) rows.push(...elements(part).filter((r) => r.nodeName === "TR"));
  }
  const grid = rows.map((r) => elements(r).filter((c) => CELLS.has(c.nodeName)));
  if (!grid.length) return "";
  const width = grid.reduce((n, r) => Math.max(n, r.length), 1);
  const line = (r: Element[]) => `|${Array.from({ length: width }, (_, i) => ` ${(r[i] && cells.get(r[i])) ?? ""} |`).join("")}`;
  const head = grid[0]?.some((c) => c.nodeName === "TH") ? (grid.shift() ?? []) : [];
  return `\n\n${[line(head), `|${" --- |".repeat(width)}`, ...grid.map(line)].join("\n")}\n\n`;
}

// base: the Jira base URL. Relative URLs resolve against it.
export function toMarkdown(html: string, base: string): string {
  const root = new URL(`${base.replace(/\/+$/, "")}/`);
  // The path after the Jira base, or null for a URL outside the Jira base.
  const inBase = (url: URL | null) =>
    url && url.origin === root.origin && url.pathname.startsWith(root.pathname) ? url.pathname.slice(root.pathname.length) : null;
  const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  const baseEscape = service.escape.bind(service);
  // CommonMark 2.4: a backslash keeps `<` and `&` from starting raw HTML or an entity.
  service.escape = (s: string) => baseEscape(s).replace(/[<&]/g, "\\$&");
  const cells = new WeakMap<Node, string>();

  service.remove((node) => REMOVE.has(node.nodeName.toLowerCase()));
  service.addRule("pre", { filter: "pre", replacement: (_, node) => `\n\n${fenced(node.textContent ?? "")}\n\n` });
  service.addRule("cell", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      cells.set(node, content.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"));
      return "";
    },
  });
  service.addRule("table", { filter: "table", replacement: (_, node) => table(node, cells) });
  service.addRule("link", {
    filter: "a",
    replacement: (content, node) => {
      const href = node.getAttribute("href");
      const url = href ? URL.parse(href, root) : null;
      if (!url || !content.trim() || (url.protocol !== "http:" && url.protocol !== "https:")) return content;
      // A Jira user mention links to the profile page.
      if (inBase(url) === "secure/ViewProfile.jspa") return content;
      return `[${content}](${url.href.replace(/[()]/g, "\\$&")})`;
    },
  });
  service.addRule("image", {
    filter: "img",
    replacement: (_, node) => {
      const src = node.getAttribute("src");
      const url = src ? URL.parse(src, root) : null;
      const id = ATTACHMENT_PATH.exec(inBase(url) ?? "")?.[1];
      const name = service.escape((node.getAttribute("alt") || node.getAttribute("title") || "").replace(/\s+/g, " ").trim());
      return id ? `![${name || `image ${id}`}](attachment:${id})` : name;
    },
  });
  return service.turndown(html);
}
