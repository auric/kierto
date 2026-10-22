// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Safe Markdown (BRIEF 3.6): no raw HTML, no remote images, links only for http(s). GFM adds tables, task lists, strikethrough, and autolinks.
import { lazy, Suspense, useMemo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type ExtraProps, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;
// The image source of a task attachment (plan r3 S-JMD): attachment:<id>.
const ATTACHMENT = "attachment:";
const plugins = [remarkGfm];
// The diagram code loads on the first ```mermaid block. The block shows as code until then.
const Diagram = lazy(() => import("../explain/Diagram").then((m) => ({ default: m.Diagram })));

// The text of a ```mermaid block, or null for another element.
function mermaidCode(pre: ExtraProps["node"]): string | null {
  const code = pre?.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return null;
  const cls = code.properties.className;
  if (!Array.isArray(cls) || !cls.includes("language-mermaid")) return null;
  return code.children.map((c) => (c.type === "text" ? c.value : "")).join("");
}

// The default keeps mailto:, xmpp:, and irc(s):, and GFM makes them from plain addresses. A URL with a scheme stays only for http(s).
const urlTransform: UrlTransform = (url, key) => {
  if (key === "src" && url.startsWith(ATTACHMENT)) return url;
  const safe = defaultUrlTransform(url);
  return /^[^/?#]*:/.test(safe) && !/^https?:/i.test(safe) ? "" : safe;
};

// images: maps an image source to a local URL; null shows the alt text. Without it, an image is a link and an attachment shows its alt text.
// Pass a stable images function: a new one remounts the rendered images.
// diagrams: a ```mermaid block shows as a diagram (src/web/explain/mermaid.ts). Only for text that Claude wrote for the user.
export function Markdown({ text, images, diagrams }: { text: string; images?: (src: string) => string | null; diagrams?: boolean }) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ node, ...props }) => {
        const code = diagrams ? mermaidCode(node) : null;
        return code === null ? (
          <pre {...props} />
        ) : (
          <Suspense
            fallback={
              <pre>
                <code>{code}</code>
              </pre>
            }
          >
            <Diagram code={code} />
          </Suspense>
        );
      },
      // A dropped URL leaves the text. A footnote link stays in the page.
      a: ({ node: _, ...props }) => (props.href ? <a {...props} {...(props.href.startsWith("#") ? {} : external)} /> : props.children),
      img: ({ src, alt }) => {
        if (typeof src !== "string" || !src) return <span>{alt}</span>;
        if (!images && !src.startsWith(ATTACHMENT))
          return (
            <a href={src} {...external}>
              {alt || src}
            </a>
          );
        const local = images?.(src) ?? null;
        // Lazy: an image in a closed fold loads only when the fold opens.
        return local ? <img src={local} alt={alt ?? ""} loading="lazy" /> : <span>{alt}</span>;
      },
      // A wide table scrolls in its own box, so it never widens the pane.
      table: ({ node: _, ...props }) => (
        <div className="rl-md-table">
          <table {...props} />
        </div>
      ),
    }),
    [images, diagrams],
  );
  return (
    <div className="rl-md">
      <ReactMarkdown skipHtml remarkPlugins={plugins} components={components} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
