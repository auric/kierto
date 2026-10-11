// Safe Markdown (BRIEF 3.6): no raw HTML, no remote images. The default URL transform drops unsafe schemes.
import { useMemo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;
// The image source of a task attachment (plan r3 S-JMD): attachment:<id>.
const ATTACHMENT = "attachment:";

const urlTransform: UrlTransform = (url, key) => (key === "src" && url.startsWith(ATTACHMENT) ? url : defaultUrlTransform(url));

// images: maps an image source to a local URL; null shows the alt text. Without it, an image is a link and an attachment shows its alt text.
// Pass a stable images function: a new one remounts the rendered images.
export function Markdown({ text, images }: { text: string; images?: (src: string) => string | null }) {
  const components = useMemo<Components>(
    () => ({
      a: ({ node: _, ...props }) => <a {...props} {...external} />,
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
    }),
    [images],
  );
  return (
    <div className="rl-md">
      <ReactMarkdown skipHtml components={components} urlTransform={urlTransform}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
