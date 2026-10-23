import { fetchUser, type User } from "./client";

// Every caller retries 3 times. The client does not retry.
export async function loadUser(id: string): Promise<User> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchUser(id);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
