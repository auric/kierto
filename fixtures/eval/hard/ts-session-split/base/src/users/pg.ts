import { SQL } from "bun";
import type { User, UserRepo } from "./repo";

// A fixed hash, so an unknown email costs one verify too.
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=2,p=1$c2FsdHNhbHRzYWx0$0m3T3fTqSIz0lTJ1FvQyH3pF1jGmXbXHWQd4m9lZb7w";

export function pgUsers(url: string): UserRepo {
  const sql = new SQL(url);
  return {
    async checkPassword(email, password) {
      const [row] = await sql`SELECT id, email, password_hash FROM users WHERE email = ${email.toLowerCase()}`;
      const ok = await Bun.password.verify(password, row?.password_hash ?? DUMMY_HASH);
      return row && ok ? ({ id: row.id, email: row.email } as User) : null;
    },
    async changePassword(userId, current, next) {
      const [row] = await sql`SELECT password_hash FROM users WHERE id = ${userId}`;
      if (!row || !(await Bun.password.verify(current, row.password_hash))) return false;
      const hash = await Bun.password.hash(next, "argon2id");
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${userId}`;
      return true;
    },
  };
}
