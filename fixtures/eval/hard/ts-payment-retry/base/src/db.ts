import pg from "pg";

export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
};

export function connect(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  };
}
