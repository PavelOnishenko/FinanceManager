import type { SqlDatabase } from "../src/storage/SqlDatabase";

export async function seedMember(database: SqlDatabase, userId: number, displayName: string) {
  await database.prepare("INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, 1)")
    .bind(String(userId), displayName).execute();
}
