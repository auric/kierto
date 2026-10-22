import pg from "pg";

export type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

export function connect(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  return { query: async (sql, params = []) => ({ rows: (await pool.query(sql, params)).rows }) };
}
