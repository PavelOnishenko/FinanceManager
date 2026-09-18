export type SqlValue = string | number | null;
export type SqlExecutionResult = { changedRows: number };

export interface SqlQuery {
  bind(...values: SqlValue[]): SqlQuery;
  one<Row extends object>(): Promise<Row | null>;
  many<Row extends object>(): Promise<Row[]>;
  execute(): Promise<SqlExecutionResult>;
}

export interface SqlSession {
  prepare(sql: string): SqlQuery;
}

export interface SqlDatabase extends SqlSession {
  withPrimarySession(): SqlSession;
}
