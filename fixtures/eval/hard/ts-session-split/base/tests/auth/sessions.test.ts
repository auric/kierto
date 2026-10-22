import { describe, expect, test } from "bun:test";
import {
  ABSOLUTE_LIFETIME_MS,
  checkCsrf,
  clearedCookie,
  csrfToken,
  firstExpiry,
  IDLE_TIMEOUT_MS,
  isExpired,
  issueToken,
  MAX_SESSIONS_PER_USER,
  type RevokeReason,
  readSessionCookie,
  remainingMs,
  ROTATION_GRACE_MS,
  SessionStore,
  sessionCookie,
  verifyToken,
} from "../../src/auth/sessions";

const MINUTE = 60_000;

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, set: (v: number) => void (t = v), add: (ms: number) => void (t += ms) };
}

const key = (n: number) => Buffer.alloc(32, n);

describe("tokens", () => {
  test("a token verifies with the key that signed it", () => {
    const token = issueToken("abc", key(1));
    expect(verifyToken(token, [key(1)])).toBe("abc");
  });

  test("a token signed with another key does not verify", () => {
    expect(verifyToken(issueToken("abc", key(2)), [key(1)])).toBeNull();
  });

  test("a retired key still verifies", () => {
    expect(verifyToken(issueToken("abc", key(2)), [key(1), key(2)])).toBe("abc");
  });

  test("a changed signature does not verify", () => {
    const token = issueToken("abc", key(1));
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyToken(`${token.slice(0, -1)}${last}`, [key(1)])).toBeNull();
  });
});

describe("expiry", () => {
  test("a new session ends after the idle timeout", () => {
    expect(firstExpiry(1_000)).toBe(1_000 + IDLE_TIMEOUT_MS);
  });

  test("a session ends at its expiry time, not one millisecond later", () => {
    expect(isExpired({ expiresAt: 5_000 }, 4_999)).toBe(false);
    expect(isExpired({ expiresAt: 5_000 }, 5_000)).toBe(true);
  });

  test("the remaining time is never negative", () => {
    expect(remainingMs({ expiresAt: 5_000 }, 2_000)).toBe(3_000);
    expect(remainingMs({ expiresAt: 5_000 }, 9_000)).toBe(0);
  });
});

describe("SessionStore", () => {
  test("a session ends after 30 minutes without a request", () => {
    const clock = fakeClock();
    const store = new SessionStore(clock.now);
    const s = store.create("u1", "agent", "10.1.2.3");
    clock.set(IDLE_TIMEOUT_MS - 1);
    expect(store.get(s.id)).not.toBeNull();
    clock.set(IDLE_TIMEOUT_MS);
    expect(store.get(s.id)).toBeNull();
  });

  test("a request keeps an active session alive", () => {
    const clock = fakeClock();
    const store = new SessionStore(clock.now);
    const s = store.create("u1", "agent", "10.1.2.3");
    clock.set(20 * MINUTE);
    expect(store.touch(s.id)).not.toBeNull();
    clock.set(45 * MINUTE);
    expect(store.get(s.id)).not.toBeNull();
  });

  test("a session ends at the absolute lifetime, however active it is", () => {
    const clock = fakeClock();
    const store = new SessionStore(clock.now);
    const s = store.create("u1", "agent", "10.1.2.3");
    for (let t = 0; t < ABSOLUTE_LIFETIME_MS; t += IDLE_TIMEOUT_MS / 2) {
      clock.set(t);
      expect(store.touch(s.id)).not.toBeNull();
    }
    clock.set(ABSOLUTE_LIFETIME_MS);
    expect(store.touch(s.id)).toBeNull();
  });

  test("keeps the IP prefix and a short user agent", () => {
    const store = new SessionStore(fakeClock().now);
    expect(store.create("u1", "x".repeat(500), "10.1.2.3")).toMatchObject({ ipPrefix: "10.1.2", userAgent: "x".repeat(200) });
    expect(store.create("u1", "agent", "2001:db8:1:2:3:4:5:6").ipPrefix).toBe("2001:db8:1:2");
  });

  test("rotate gives a new ID and keeps the old one for the grace period", () => {
    const clock = fakeClock(1_000);
    const store = new SessionStore(clock.now);
    const s = store.create("u1", "agent", "10.1.2.3");
    clock.add(5 * MINUTE);
    const next = store.rotate(s.id);
    expect(next?.id).not.toBe(s.id);
    expect(next).toMatchObject({ userId: "u1", createdAt: 1_000, rotatedFrom: s.id });
    expect(next?.csrfSecret).not.toBe(s.csrfSecret);
    expect(store.get(s.id)?.id).toBe(next?.id as string);
    clock.add(ROTATION_GRACE_MS);
    expect(store.get(s.id)).toBeNull();
    expect(store.get(next?.id as string)).not.toBeNull();
  });

  test("revoke ends one session and reports the reason", () => {
    const store = new SessionStore(fakeClock().now);
    const s = store.create("u1", "agent", "10.1.2.3");
    const seen: [string, RevokeReason][] = [];
    store.on("revoked", (id, reason) => seen.push([id, reason]));
    expect(store.revoke(s.id, "logout")).toBe(true);
    expect(store.revoke(s.id, "logout")).toBe(false);
    expect(seen).toEqual([[s.id, "logout"]]);
  });

  test("revokeUser ends the other sessions of a user and keeps the given one", () => {
    const store = new SessionStore(fakeClock().now);
    const a = store.create("u1", "agent", "10.1.2.3");
    const b = store.create("u1", "agent", "10.1.2.4");
    const c = store.create("u2", "agent", "10.1.2.5");
    expect(store.revokeUser("u1", "password-change", a.id)).toBe(1);
    expect(store.get(a.id)).not.toBeNull();
    expect(store.get(b.id)).toBeNull();
    expect(store.get(c.id)).not.toBeNull();
  });

  test("revokeUser also ends the grace ID of a rotated session", () => {
    const store = new SessionStore(fakeClock().now);
    const a = store.create("u1", "agent", "10.1.2.3");
    const next = store.rotate(a.id);
    store.revokeUser("u1", "admin");
    expect(store.get(a.id)).toBeNull();
    expect(store.get(next?.id as string)).toBeNull();
  });

  test("a new login beyond the limit ends the least recently used session", () => {
    const clock = fakeClock();
    const store = new SessionStore(clock.now);
    const ids: string[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
      clock.add(1_000);
      ids.push(store.create("u1", "agent", "10.1.2.3").id);
    }
    clock.add(1_000);
    store.touch(ids[0] as string);
    clock.add(1_000);
    store.create("u1", "agent", "10.1.2.3");
    expect(store.listForUser("u1")).toHaveLength(MAX_SESSIONS_PER_USER);
    expect(store.get(ids[0] as string)).not.toBeNull();
    expect(store.get(ids[1] as string)).toBeNull();
  });

  test("listForUser gives the most recently used session first", () => {
    const clock = fakeClock();
    const store = new SessionStore(clock.now);
    const a = store.create("u1", "agent", "10.1.2.3");
    clock.add(1_000);
    const b = store.create("u1", "agent", "10.1.2.4");
    clock.add(1_000);
    store.touch(a.id);
    expect(store.listForUser("u1").map((s) => s.id)).toEqual([a.id, b.id]);
  });

  test("sweep ends only the expired sessions", () => {
    const clock = fakeClock();
    const store = new SessionStore(clock.now);
    const idle = store.create("u1", "agent", "10.1.2.3");
    const busy = store.create("u2", "agent", "10.1.2.4");
    clock.set(20 * MINUTE);
    store.touch(busy.id);
    clock.set(31 * MINUTE);
    expect(store.sweep()).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(idle.id)).toBeNull();
    expect(store.get(busy.id)).not.toBeNull();
  });
});

describe("cookies", () => {
  test("the session cookie is HttpOnly and lives as long as the session", () => {
    const cookie = sessionCookie("tok", { expiresAt: IDLE_TIMEOUT_MS }, { secure: true }, 0);
    expect(cookie).toBe("sid=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800; Secure");
  });

  test("the domain goes into both cookies", () => {
    expect(sessionCookie("tok", { expiresAt: 1_000 }, { secure: false, domain: "example.test" }, 0)).toContain("Domain=example.test");
    expect(clearedCookie({ secure: true, domain: "example.test" })).toBe(
      "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure; Domain=example.test",
    );
  });

  test("reads the session cookie among other cookies", () => {
    expect(readSessionCookie("theme=dark; sid=abc.def; lang=en")).toBe("abc.def");
    expect(readSessionCookie("theme=dark")).toBeNull();
    expect(readSessionCookie(undefined)).toBeNull();
  });
});

describe("csrf", () => {
  const s = { id: "abc", csrfSecret: "secret" };

  test("accepts the token of the session", () => {
    expect(checkCsrf(s, csrfToken(s))).toBe(true);
  });

  test("refuses a missing, a short, or another token", () => {
    expect(checkCsrf(s, undefined)).toBe(false);
    expect(checkCsrf(s, "short")).toBe(false);
    expect(checkCsrf(s, csrfToken({ id: "abd", csrfSecret: "secret" }))).toBe(false);
  });
});
