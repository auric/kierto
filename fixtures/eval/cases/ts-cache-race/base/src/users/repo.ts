import type { Db } from "../db";
import type { User, UserPatch } from "./types";

const COLUMNS = "id, name, email, team_id AS teamId, updated_at AS updatedAt";
const PATCH_COLUMNS = [
  ["name", "name"],
  ["email", "email"],
  ["teamId", "team_id"],
] as const;

export class UserRepo {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.query<User>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findByTeam(teamId: string): Promise<User[]> {
    return this.db.query<User>(`SELECT ${COLUMNS} FROM users WHERE team_id = $1 ORDER BY name`, [teamId]);
  }

  async update(id: string, patch: UserPatch): Promise<User | null> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of PATCH_COLUMNS) {
      const value = patch[key];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return this.findById(id);
    params.push(Date.now());
    sets.push(`updated_at = $${params.length}`);
    const rows = await this.db.query<User>(`UPDATE users SET ${sets.join(", ")} WHERE id = $1 RETURNING ${COLUMNS}`, params);
    return rows[0] ?? null;
  }
}
