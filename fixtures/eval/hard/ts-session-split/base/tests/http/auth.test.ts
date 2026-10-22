import { describe, expect, test } from "bun:test";
import { csrfToken, issueToken, SessionStore } from "../../src/auth/sessions";
import { requireSession } from "../../src/http/auth";
import type { Request } from "../../src/http/server";

const key = Buffer.alloc(32, 7);
const ok = async (req: Request) => ({ status: 200, body: { user: req.session?.userId } });

function request(o: Partial<Request>): Request {
  return { method: "GET", path: "/", headers: {}, ip: "10.1.2.3", body: null, ...o };
}

describe("requireSession", () => {
  test("passes a request with a valid session cookie", async () => {
    const store = new SessionStore();
    const s = store.create("u1", "agent", "10.1.2.3");
    const handler = requireSession(store, [key], ok);
    const res = await handler(request({ headers: { cookie: `sid=${issueToken(s.id, key)}` } }));
    expect(res).toMatchObject({ status: 200, body: { user: "u1" } });
  });

  test("refuses a malformed cookie before it checks the signature", async () => {
    const handler = requireSession(new SessionStore(), [key], ok);
    for (const cookie of ["sid=", "sid=abc", "sid=a.b.c", `sid=${"a".repeat(43)}.${"b".repeat(42)}`])
      expect((await handler(request({ headers: { cookie } }))).status).toBe(401);
  });

  test("needs the CSRF header for a POST", async () => {
    const store = new SessionStore();
    const s = store.create("u1", "agent", "10.1.2.3");
    const handler = requireSession(store, [key], ok);
    const cookie = `sid=${issueToken(s.id, key)}`;
    expect((await handler(request({ method: "POST", headers: { cookie } }))).status).toBe(403);
    const res = await handler(request({ method: "POST", headers: { cookie, "x-csrf-token": csrfToken(s) } }));
    expect(res.status).toBe(200);
  });
});
