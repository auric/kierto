// Postgres client wrapper. Parameters use $1, $2, ... placeholders.
export interface Db {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
