// ─── Notifications (server) ───
// The Cadence-owned server interface to whatever delivers Notifications. Only
// the Knock adapter (knock-notifications.server.ts) knows the vendor exists;
// everything else speaks Cadence's language: events, categories and the `feed`
// channel. See GLOSSARY.md for Notification and Notification Feed.
//
// Services take a `NotificationService` as an injected parameter, like the
// database and the current time. Tests inject the in-memory fake.

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** One kind of Notification, as in the catalogue. */
export type NotificationEvent =
  | "refund-approved"
  | "refund-declined"
  | "refund-opened"
  | "seat-claimed"
  | "enrollment-created"
  | "discussion-question-asked"
  | "discussion-reply-posted"
  | "refund-confirmed";

/** What a person switches on or off. Several events share a category. */
export type NotificationCategory =
  | "refund-request-updates"
  | "open-refund-requests"
  | "seat-claims"
  | "enrollments"
  | "discussion-questions"
  | "discussion-replies";

/** Only the Feed exists in v1. Email would be a second channel. */
export type NotificationChannel = "feed";

export type NotificationUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/** Who a Notification came from. `null` means Cadence itself. */
export type NotificationSender = {
  id: number;
  name: string;
  avatarUrl: string | null;
} | null;

/**
 * A Notification is a snapshot taken when it is sent, and the Feed writes its
 * text from this data. Every Notification names its sender and where clicking
 * it goes (`null` when it goes nowhere); the rest depends on the event.
 */
export type NotificationData = {
  sender: NotificationSender;
  link: string | null;
  [key: string]: JsonValue;
};

export type NotificationTrigger = {
  event: NotificationEvent;
  category: NotificationCategory;
  recipient: NotificationUser;
  /** One per domain event, e.g. `refund-approved:<refundRequestId>`. A trigger
   * to several recipients repeats it; adapters scope it per recipient. */
  idempotencyKey: string;
  data: NotificationData;
};

/** Category × channel. A missing entry means the default applies. */
export type NotificationPreferences = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

export type NotificationService = {
  trigger(notification: NotificationTrigger): Promise<void>;
  /** `null` when the user has no preferences yet. */
  getPreferences(userId: number): Promise<NotificationPreferences | null>;
  /** Merges the changes into the user's preferences; never replaces them. */
  mergePreferences(
    userId: number,
    changes: NotificationPreferences
  ): Promise<void>;
  /** Sets the user's name, email and avatar. Never touches preferences. */
  syncUser(user: NotificationUser): Promise<void>;
  /** Archives the Notifications a comment caused. */
  archiveForComment(commentId: number): Promise<void>;
};

export function mergePreferences(
  existing: NotificationPreferences | null,
  changes: NotificationPreferences
): NotificationPreferences {
  const merged: NotificationPreferences = { ...existing };
  for (const category of Object.keys(changes) as NotificationCategory[]) {
    merged[category] = { ...merged[category], ...changes[category] };
  }
  return merged;
}

/**
 * Sends a Notification without ever failing the caller. A failure — thrown or
 * rejected — is logged and dropped: delivery is best-effort, and a vendor
 * outage must not undo a refund or a comment. Fire it after the write commits.
 */
export function triggerSafely(
  notifications: NotificationService,
  notification: NotificationTrigger
): void {
  logFailure(
    () => notifications.trigger(notification),
    `trigger ${notification.idempotencyKey}`
  );
}

/** Archives a comment's Notifications without ever failing the caller. */
export function archiveForCommentSafely(
  notifications: NotificationService,
  commentId: number
): void {
  logFailure(
    () => notifications.archiveForComment(commentId),
    `archive for comment ${commentId}`
  );
}

function logFailure(attempt: () => Promise<void>, what: string): void {
  const log = (error: unknown) =>
    console.error(`[notifications] ${what} failed`, error);
  try {
    attempt().catch(log);
  } catch (error) {
    log(error);
  }
}

export type FakeNotifications = NotificationService & {
  triggers: NotificationTrigger[];
  syncedUsers: NotificationUser[];
  /** Each call to `mergePreferences`, in order. */
  preferenceWrites: { userId: number; changes: NotificationPreferences }[];
  archivedCommentIds: number[];
};

/** Records everything and talks to nobody. For tests. */
export function createFakeNotifications(): FakeNotifications {
  const stored = new Map<number, NotificationPreferences>();
  const fake: FakeNotifications = {
    triggers: [],
    syncedUsers: [],
    preferenceWrites: [],
    archivedCommentIds: [],
    async trigger(notification) {
      fake.triggers.push(notification);
    },
    async getPreferences(userId) {
      return stored.get(userId) ?? null;
    },
    async mergePreferences(userId, changes) {
      fake.preferenceWrites.push({ userId, changes });
      stored.set(userId, mergePreferences(stored.get(userId) ?? null, changes));
    },
    async syncUser(user) {
      fake.syncedUsers.push(user);
    },
    async archiveForComment(commentId) {
      fake.archivedCommentIds.push(commentId);
    },
  };
  return fake;
}

/**
 * Used when no vendor key is configured, so the app runs locally without
 * signing up for anything. Logs what it would have done.
 */
export function createLoggingNotifications(
  log: (message: string) => void = console.log
): NotificationService {
  return {
    async trigger(notification) {
      log(
        `[notifications] trigger ${notification.event} to user ${notification.recipient.id} (${notification.idempotencyKey})`
      );
    },
    async getPreferences() {
      return null;
    },
    async mergePreferences(userId) {
      log(`[notifications] merge preferences for user ${userId}`);
    },
    async syncUser(user) {
      log(`[notifications] sync user ${user.id}`);
    },
    async archiveForComment(commentId) {
      log(`[notifications] archive notifications for comment ${commentId}`);
    },
  };
}
