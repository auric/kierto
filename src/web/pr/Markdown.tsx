// Safe Markdown (BRIEF 3.6): no raw HTML, no remote images. The default URL transform drops unsafe schemes.
import ReactMarkdown, { type Components } from "react-markdown";

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

const components: Components = {
  a: ({ node: _, ...props }) => <a {...props} {...external} />,
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} {...external}>
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="rl-md">
      <ReactMarkdown skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
