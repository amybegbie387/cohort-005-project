// ─── Notification preferences (pure) ───
// Which preference switches a person sees. It depends on what they are or
// have, not on their role alone: a Student who buys a Team Licence is a Team
// Admin and sees Seat claims.

import { UserRole } from "~/db/schema";
import type { NotificationCategory } from "~/lib/notifications.server";

export type PreferenceFacts = {
  role: UserRole;
  /** Has made at least one Purchase. */
  hasPurchase: boolean;
  /** Is a Team Admin on at least one Team Licence. */
  isTeamAdmin: boolean;
};

/** The glossary's names, as shown beside each switch. */
export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory,
  string
> = {
  "refund-request-updates": "Refund Request updates",
  "open-refund-requests": "Open Refund Requests",
  "seat-claims": "Seat claims",
  enrollments: "Enrollments",
  "discussion-questions": "Discussion Questions",
  "discussion-replies": "Discussion Replies",
};

export const NOTIFICATION_CATEGORIES = Object.keys(
  NOTIFICATION_CATEGORY_LABELS
) as [NotificationCategory, ...NotificationCategory[]];

/** The categories to show a switch for, in display order. */
export function visibleNotificationCategories(
  facts: PreferenceFacts
): NotificationCategory[] {
  const visible: NotificationCategory[] = [];
  if (facts.hasPurchase) visible.push("refund-request-updates");
  if (facts.role === UserRole.Admin) visible.push("open-refund-requests");
  if (facts.isTeamAdmin) visible.push("seat-claims");
  if (facts.role === UserRole.Instructor) {
    visible.push("enrollments", "discussion-questions");
  }
  visible.push("discussion-replies");
  return visible;
}
