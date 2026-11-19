// One-off: syncs every existing user to the Notification vendor and writes the
// default preferences for anyone who has none. Safe to re-run; it never
// overwrites a user's choices. Run it with `npm run notifications:backfill`.
// Without KNOCK_SECRET_API_KEY it only logs what it would have done.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema";
import { syncAllUsers } from "../app/lib/notification-users.server";
import { getNotifications } from "../app/lib/notifications-instance.server";

const sqlite = new Database("data.db");
const db = drizzle(sqlite, { schema });

const { synced, failed } = await syncAllUsers(db, getNotifications());
sqlite.close();

console.log(`Notification users: ${synced} synced, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
