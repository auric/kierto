export interface Db {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}
