// Safe Markdown (BRIEF 3.6): no raw HTML, no remote images, links only for http(s). GFM adds tables, task lists, strikethrough, and autolinks.
import { useMemo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;
// The image source of a task attachment (plan r3 S-JMD): attachment:<id>.
const ATTACHMENT = "attachment:";
const plugins = [remarkGfm];

// The default keeps mailto:, xmpp:, and irc(s):, and GFM makes them from plain addresses. A URL with a scheme stays only for http(s).
const urlTransform: UrlTransform = (url, key) => {
  if (key === "src" && url.startsWith(ATTACHMENT)) return url;
  const safe = defaultUrlTransform(url);
  return /^[^/?#]*:/.test(safe) && !/^https?:/i.test(safe) ? "" : safe;
};

// images: maps an image source to a local URL; null shows the alt text. Without it, an image is a link and an attachment shows its alt text.
// Pass a stable images function: a new one remounts the rendered images.
export function Markdown({ text, images }: { text: string; images?: (src: string) => string | null }) {
  const components = useMemo<Components>(
    () => ({
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
        return local ? <img src={local} alt={alt ?? ""} /> : <span>{alt}</span>;
      },
      // A wide table scrolls in its own box, so it never widens the pane.
      table: ({ node: _, ...props }) => (
        <div className="rl-md-table">
          <table {...props} />
        </div>
      ),
    }),
    [images],
  );
  return (
    <div className="rl-md">
      <ReactMarkdown skipHtml remarkPlugins={plugins} components={components} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
