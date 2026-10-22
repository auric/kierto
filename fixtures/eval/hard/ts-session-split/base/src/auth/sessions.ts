import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";

// ---- Types and limits ----

export type SessionId = string;

export type Session = {
  id: SessionId;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  // The user agent and the IP prefix at login. The account page shows them; no check uses them.
  userAgent: string;
  ipPrefix: string;
  // Set by rotate(): the ID that this session replaced. The audit trail keeps it.
  rotatedFrom: SessionId | null;
  csrfSecret: string;
};

export type RevokeReason = "logout" | "expired" | "password-change" | "limit" | "admin";

export type SessionEvents = {
  created: [session: Session];
  rotated: [from: SessionId, to: Session];
  revoked: [id: SessionId, reason: RevokeReason];
};

// A session ends after 30 minutes without a request.
export const IDLE_TIMEOUT_MS = 30 * 60_000;
// A session never lives longer than 12 hours, however active it is.
export const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60_000;
// A user can hold this many sessions. create() ends the least recently used ones beyond it.
export const MAX_SESSIONS_PER_USER = 10;
// After rotate(), the old ID stays valid this long, for requests that were already in flight.
export const ROTATION_GRACE_MS = 30_000;

export const SESSION_COOKIE = "sid";
export const CSRF_HEADER = "x-csrf-token";

// ---- Tokens ----

// A token is "<id>.<signature>": 32 random bytes and the HMAC-SHA256 of the id, both base64url without padding.
export function newSessionId(): SessionId {
  return randomBytes(32).toString("base64url");
}

export function sign(id: SessionId, key: Buffer): string {
  return createHmac("sha256", key).update(id).digest("base64url");
}

export function issueToken(id: SessionId, key: Buffer): string {
  return `${id}.${sign(id, key)}`;
}

// The session ID of a token with a valid signature, or null. keys: the current key first, then the keys being retired.
export function verifyToken(raw: string, keys: readonly Buffer[]): SessionId | null {
  const [id, sig] = raw.split(".") as [string, string];
  for (const key of keys) {
    const expected = sign(id, key);
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return id;
  }
  return null;
}

// ---- Expiry ----

export function firstExpiry(now: number): number {
  return now + IDLE_TIMEOUT_MS;
}

// Sliding expiry: each request moves the end to now + IDLE_TIMEOUT_MS, but never past createdAt + ABSOLUTE_LIFETIME_MS.
export function nextExpiry(s: Pick<Session, "createdAt">, now: number): number {
  return Math.min(now + IDLE_TIMEOUT_MS, s.createdAt + ABSOLUTE_LIFETIME_MS);
}

export function isExpired(s: Pick<Session, "expiresAt">, now: number): boolean {
  return now >= s.expiresAt;
}

// Milliseconds until the session ends, for the warning banner. 0 when it already ended.
export function remainingMs(s: Pick<Session, "expiresAt">, now: number): number {
  return Math.max(0, s.expiresAt - now);
}

// ---- Store ----

export type Clock = () => number;

// The first three octets of an IPv4 address, or the first four groups of an IPv6 address.
export function ipPrefix(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":");
  return ip.split(".").slice(0, 3).join(".");
}

const secret = () => randomBytes(16).toString("base64url");

// The sessions of this process. The load balancer pins each user to one process, so the store needs no shared backend.
export class SessionStore extends EventEmitter<SessionEvents> {
  private readonly sessions = new Map<SessionId, Session>();
  private readonly byUser = new Map<string, Set<SessionId>>();
  // IDs that rotate() replaced: the new ID, and the time when the old one stops working.
  private readonly graceIds = new Map<SessionId, { to: SessionId; until: number }>();

  constructor(private readonly clock: Clock = Date.now) {
    super();
  }

  create(userId: string, userAgent: string, ip: string): Session {
    const now = this.clock();
    const s: Session = {
      id: newSessionId(),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: firstExpiry(now),
      userAgent: userAgent.slice(0, 200),
      ipPrefix: ipPrefix(ip),
      rotatedFrom: null,
      csrfSecret: secret(),
    };
    this.sessions.set(s.id, s);
    this.index(s);
    this.enforceLimit(userId);
    this.emit("created", s);
    return s;
  }

  // The live session of an ID, or null. During the grace period, a rotated ID gives its new session.
  get(id: SessionId): Session | null {
    const now = this.clock();
    const grace = this.graceIds.get(id);
    if (grace) {
      if (grace.until > now) return this.get(grace.to);
      this.graceIds.delete(id);
      return null;
    }
    const s = this.sessions.get(id);
    if (!s) return null;
    if (isExpired(s, now)) {
      this.end(s, "expired");
      return null;
    }
    return s;
  }

  // Records a request: moves lastSeenAt and the expiry. Returns the session, or null when it ended.
  touch(id: SessionId): Session | null {
    const s = this.get(id);
    if (!s) return null;
    const now = this.clock();
    s.lastSeenAt = now;
    s.expiresAt = nextExpiry(s, now);
    return s;
  }

  // Gives a session a new ID after a privilege change, such as a login or a password check.
  rotate(id: SessionId): Session | null {
    const old = this.get(id);
    if (!old) return null;
    const now = this.clock();
    const next: Session = { ...old, id: newSessionId(), rotatedFrom: old.id, lastSeenAt: now, csrfSecret: secret() };
    this.sessions.delete(old.id);
    this.unindex(old);
    this.sessions.set(next.id, next);
    this.index(next);
    this.graceIds.set(old.id, { to: next.id, until: now + ROTATION_GRACE_MS });
    this.emit("rotated", old.id, next);
    return next;
  }

  revoke(id: SessionId, reason: RevokeReason): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    this.end(s, reason);
    return true;
  }

  // Ends each session of a user, for example after a password change. keep: a session to keep, such as the current one.
  revokeUser(userId: string, reason: RevokeReason, keep?: SessionId): number {
    const ids = [...(this.byUser.get(userId) ?? [])].filter((id) => id !== keep);
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (s) this.end(s, reason);
    }
    for (const [old, g] of this.graceIds) if (ids.includes(g.to)) this.graceIds.delete(old);
    return ids.length;
  }

  // The live sessions of a user, most recently used first.
  listForUser(userId: string): Session[] {
    return [...(this.byUser.get(userId) ?? [])]
      .flatMap((id) => {
        const s = this.get(id);
        return s ? [s] : [];
      })
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  // Removes ended sessions and old grace IDs. Returns the number of sessions that ended.
  sweep(): number {
    const now = this.clock();
    let ended = 0;
    for (const s of [...this.sessions.values()]) {
      if (!isExpired(s, now)) continue;
      this.end(s, "expired");
      ended++;
    }
    for (const [old, g] of this.graceIds) if (g.until <= now) this.graceIds.delete(old);
    return ended;
  }

  get size(): number {
    return this.sessions.size;
  }

  private end(s: Session, reason: RevokeReason): void {
    this.sessions.delete(s.id);
    this.unindex(s);
    this.emit("revoked", s.id, reason);
  }

  private index(s: Session): void {
    let ids = this.byUser.get(s.userId);
    if (!ids) {
      ids = new Set();
      this.byUser.set(s.userId, ids);
    }
    ids.add(s.id);
  }

  private unindex(s: Session): void {
    const ids = this.byUser.get(s.userId);
    if (!ids) return;
    ids.delete(s.id);
    if (ids.size === 0) this.byUser.delete(s.userId);
  }

  private enforceLimit(userId: string): void {
    const ids = this.byUser.get(userId);
    if (!ids || ids.size <= MAX_SESSIONS_PER_USER) return;
    const byAge = [...ids]
      .map((id) => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const s of byAge.slice(0, ids.size - MAX_SESSIONS_PER_USER)) this.end(s, "limit");
  }
}

// ---- Cookies ----

export type CookieOptions = { secure: boolean; domain?: string };

export function sessionCookie(token: string, s: Pick<Session, "expiresAt">, o: CookieOptions, now: number): string {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.ceil(remainingMs(s, now) / 1000)}`];
  if (o.secure) parts.push("Secure");
  if (o.domain) parts.push(`Domain=${o.domain}`);
  return parts.join("; ");
}

export function clearedCookie(o: CookieOptions): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (o.secure) parts.push("Secure");
  if (o.domain) parts.push(`Domain=${o.domain}`);
  return parts.join("; ");
}

// The value of the session cookie in a Cookie header, or null.
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

// ---- CSRF ----

// The CSRF token of a session: the HMAC of the session ID with the secret of the session. Pages put it into each form.
export function csrfToken(s: Pick<Session, "id" | "csrfSecret">): string {
  return createHmac("sha256", s.csrfSecret).update(s.id).digest("base64url");
}

export function checkCsrf(s: Pick<Session, "id" | "csrfSecret">, sent: string | undefined): boolean {
  if (!sent) return false;
  const want = Buffer.from(csrfToken(s));
  const got = Buffer.from(sent);
  return want.length === got.length && timingSafeEqual(want, got);
}
