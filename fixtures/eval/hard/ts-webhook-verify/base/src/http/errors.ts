import { type Handler, json } from "./server";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Wraps the router. An HttpError gives its status, a SyntaxError from JSON.parse gives 400, and any other error gives 500.
export function withErrors(handler: Handler, log: (message: string) => void): Handler {
  return async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      if (e instanceof SyntaxError) return json(400, { error: "The body is not valid JSON." });
      log(`${req.method} ${req.path} failed: ${e instanceof Error ? e.stack : String(e)}`);
      return json(500, { error: "internal error" });
    }
  };
}
