// Converts one rendered Jira field per request. The parent terminates this worker when a request passes its budget.
import { toMarkdown } from "./markdown";

declare const self: Worker;

export type ConvertRequest = { id: number; html: string; base: string };
export type ConvertReply = { id: number; markdown: string } | { id: number; error: string };

self.onmessage = (e: MessageEvent<ConvertRequest>) => {
  const { id, html, base } = e.data;
  try {
    self.postMessage({ id, markdown: toMarkdown(html, base) } satisfies ConvertReply);
  } catch (err) {
    // Deep nesting overflows the stack of the converter.
    self.postMessage({ id, error: String(err) } satisfies ConvertReply);
  }
};

self.postMessage("ready");
