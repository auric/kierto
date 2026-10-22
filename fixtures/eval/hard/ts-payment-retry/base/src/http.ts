export class HttpTimeout extends Error {}

export type HttpResponse = { status: number; body: Record<string, unknown> };

export type HttpClient = {
  post(path: string, body: unknown, o: { headers: Record<string, string>; timeoutMs: number }): Promise<HttpResponse>;
};

export function httpClient(baseUrl: string): HttpClient {
  return {
    async post(path, body, o) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...o.headers },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(o.timeoutMs),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "TimeoutError") throw new HttpTimeout(`POST ${path} timed out`);
        throw e;
      }
      const text = await res.text();
      return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
    },
  };
}
