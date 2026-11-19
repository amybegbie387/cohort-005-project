// ─── Notification preferences (server) ───
// Reads and saves the switches on /settings. Takes the Notification service as
// an injected parameter, like the other services. A save merges one category
// into the person's preference set; it never replaces the set.

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  NOTIFICATION_CATEGORY_LABELS,
  visibleNotificationCategories,
} from "~/lib/notification-preferences";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "~/lib/notification-users.server";
import type {
  NotificationCategory,
  NotificationPreferences,
  NotificationService,
} from "~/lib/notifications.server";

type Db = BetterSQLite3Database<typeof schema>;

export type NotificationSwitch = {
  category: NotificationCategory;
  label: string;
  enabled: boolean;
};

/**
 * The switches this person sees, with their current values. A category with
 * no stored choice shows its default, so a switch that was hidden appears
 * later with the right value. If the preferences cannot be read, every switch
 * shows its default.
 */
export async function getNotificationSwitches(
  db: Db,
  notifications: NotificationService,
  userId: number
): Promise<NotificationSwitch[]> {
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return [];

  const hasPurchase =
    db
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(eq(schema.purchases.userId, userId))
      .limit(1)
      .get() !== undefined;
  const isTeamAdmin =
    db
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.userId, userId),
          eq(schema.teamMembers.role, schema.TeamMemberRole.Admin)
        )
      )
      .limit(1)
      .get() !== undefined;

  const stored = await readPreferences(notifications, userId);

  return visibleNotificationCategories({
    role: user.role,
    hasPurchase,
    isTeamAdmin,
  }).map((category) => ({
    category,
    label: NOTIFICATION_CATEGORY_LABELS[category],
    enabled:
      stored?.[category]?.feed ?? DEFAULT_NOTIFICATION_PREFERENCES[category].feed,
  }));
}

async function readPreferences(
  notifications: NotificationService,
  userId: number
): Promise<NotificationPreferences | null> {
  try {
    return await notifications.getPreferences(userId);
  } catch (error) {
    console.error(`[notifications] read preferences for user ${userId} failed`, error);
    return null;
  }
}

/**
 * Saves one switch: only that category's feed channel is written, merged into
 * the existing set. Throws if the save fails, so the caller can tell the person.
 */
export async function saveNotificationSwitch(
  notifications: NotificationService,
  userId: number,
  category: NotificationCategory,
  enabled: boolean
): Promise<void> {
  await notifications.mergePreferences(userId, {
    [category]: { feed: enabled },
  });
}
