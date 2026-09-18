import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { SqlDatabase, SqlQuery, SqlSession, SqlValue } from "./SqlDatabase";

export type CloudflareD1Binding = D1Database;

export class CloudflareD1Database implements SqlDatabase {
  constructor(private readonly database: CloudflareD1Binding) {}

  prepare(sql: string): SqlQuery {
    return new CloudflareD1Query(this.database.prepare(sql));
  }

  withPrimarySession(): SqlSession {
    const session = this.database.withSession("first-primary");
    return { prepare: sql => new CloudflareD1Query(session.prepare(sql)) };
  }
}

class CloudflareD1Query implements SqlQuery {
  constructor(private readonly statement: D1PreparedStatement) {}

  bind(...values: SqlValue[]): SqlQuery {
    return new CloudflareD1Query(this.statement.bind(...values));
  }

  one<Row extends object>(): Promise<Row | null> {
    return this.statement.first<Row>();
  }

  async many<Row extends object>(): Promise<Row[]> {
    return (await this.statement.all<Row>()).results;
  }

  async execute() {
    return { changedRows: (await this.statement.run()).meta.changes };
  }
}
