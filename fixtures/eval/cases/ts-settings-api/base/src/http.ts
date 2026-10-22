export type Request = {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
  user: { id: string; admin: boolean } | null;
};

export type Response = { status: number; body?: unknown };

export type Route = {
  method: "GET" | "PUT";
  // A segment like :name(a|b) matches only the listed values.
  path: string;
  handle: (req: Request) => Promise<Response>;
};
