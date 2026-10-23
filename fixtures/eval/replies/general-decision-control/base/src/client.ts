// A small HTTP client for the user service.
export type User = { id: string; name: string };

export async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`fetchUser failed: ${res.status}`);
  return (await res.json()) as User;
}
