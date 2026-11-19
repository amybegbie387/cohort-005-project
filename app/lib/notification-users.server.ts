// ─── Notification users (server) ───
// Keeps each Cadence user known to the Notification vendor: name, email and
// avatar, plus a default preference set written once. Role stays in Cadence.
//
// Takes the Notification service as an injected parameter, like the other
// services. Callers outside a script fire it without awaiting: it never throws.

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationService,
} from "~/lib/notifications.server";

type Db = BetterSQLite3Database<typeof schema>;

/** What a user gets before they choose: Enrollments off, everything else on. */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  "refund-request-updates": { feed: true },
  "open-refund-requests": { feed: true },
  "seat-claims": { feed: true },
  enrollments: { feed: false },
  "discussion-questions": { feed: true },
  "discussion-replies": { feed: true },
} as const satisfies Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
>;

type SyncableUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/**
 * Sets the user's name, email and avatar at the vendor, and writes the default
 * preferences only if they have none yet, so a re-sync never undoes their
 * choices. Never throws: a failure is logged and reported as `false`, so it
 * cannot fail a signup or an edit.
 */
export async function syncNotificationUser(
  notifications: NotificationService,
  user: SyncableUser
): Promise<boolean> {
  try {
    await notifications.syncUser({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    });
    if ((await notifications.getPreferences(user.id)) === null) {
      await notifications.mergePreferences(
        user.id,
        DEFAULT_NOTIFICATION_PREFERENCES
      );
    }
    return true;
  } catch (error) {
    console.error(`[notifications] sync user ${user.id} failed`, error);
    return false;
  }
}

/** Syncs every user, one at a time. For the seed and the backfill. */
export async function syncAllUsers(
  db: Db,
  notifications: NotificationService
): Promise<{ synced: number; failed: number }> {
  const result = { synced: 0, failed: 0 };
  for (const user of db.select().from(schema.users).all()) {
    if (await syncNotificationUser(notifications, user)) result.synced++;
    else result.failed++;
  }
  return result;
}
