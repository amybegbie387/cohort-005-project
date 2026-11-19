// ─── Notification Feed (client interface) ───
// The Cadence-owned interface the Feed components call. Only the Knock adapter
// (knock-feed-client.ts) knows the vendor exists; swapping vendors means
// writing another adapter and changing `createFeedClient`, nothing else.
//
// One client is one signed-in user's connection. Make a new one when the
// user changes, and `teardown` the old one.

import type { NotificationEvent } from "~/lib/notifications.server";

/** What the browser needs to connect. Never holds a secret. */
export type FeedConfig = {
  publicApiKey: string;
  feedChannelId: string;
};

/** Who a Notification came from. `null` means Cadence itself. */
export type FeedSender = {
  id: string;
  name: string;
  avatarUrl: string | null;
} | null;

export type FeedNotification = {
  id: string;
  /** The catalogue event, e.g. `discussion-reply-posted`. */
  event: NotificationEvent;
  sender: FeedSender;
  /** Where clicking goes; `null` when it goes nowhere. */
  link: string | null;
  /** The event's snapshot data, as written when it was sent. */
  data: Record<string, unknown>;
  insertedAt: string;
  /** Opening the Feed marks Notifications seen. Seen is not read. */
  seen: boolean;
  read: boolean;
};

export type FeedCounts = {
  /** Drives the bell's badge. Covers Notifications not loaded yet. */
  unseen: number;
  unread: number;
};

export type FeedPage = {
  /** Newest first. */
  items: FeedNotification[];
  /** Pass to `list` for the next page; `null` when history has run out. */
  nextCursor: string | null;
  counts: FeedCounts;
};

/** Notifications that arrived live, with the counts after them. */
export type FeedUpdate = {
  items: FeedNotification[];
  counts: FeedCounts;
};

export type NotificationFeedClient = {
  /** The first page without a cursor (also a refresh), else the page after it. */
  list(options?: { cursor?: string | null }): Promise<FeedPage>;
  /** The latest counts the client knows. */
  getCounts(): FeedCounts;
  markRead(id: string): Promise<FeedCounts>;
  /** Covers Notifications that have not loaded yet. */
  markAllRead(): Promise<FeedCounts>;
  /** Covers Notifications that have not loaded yet. */
  markAllSeen(): Promise<FeedCounts>;
  /** Live updates over the vendor's real-time connection. Nothing polls. */
  subscribe(listener: (update: FeedUpdate) => void): () => void;
  /** Closes the connection. The client is unusable afterwards. */
  teardown(): void;
};

const NO_COUNTS: FeedCounts = { unseen: 0, unread: 0 };

/** Used when no vendor key is configured: the Feed is simply empty. */
export function createEmptyFeedClient(): NotificationFeedClient {
  return {
    async list() {
      return { items: [], nextCursor: null, counts: NO_COUNTS };
    },
    getCounts: () => NO_COUNTS,
    async markRead() {
      return NO_COUNTS;
    },
    async markAllRead() {
      return NO_COUNTS;
    },
    async markAllSeen() {
      return NO_COUNTS;
    },
    subscribe: () => () => {},
    teardown() {},
  };
}

/** Where the browser fetches its signed token. */
const TOKEN_URL = "/api/notification-token";

async function fetchToken(userId: number): Promise<string> {
  const response = await fetch(TOKEN_URL, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Could not get a Feed token (${response.status})`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    !("userId" in body) ||
    body.userId !== userId
  ) {
    // The session moved to another user while this one was connecting.
    throw new Error("Feed token is for a different user");
  }
  return body.token;
}

/**
 * Connects the Feed as `userId`, or returns the empty client when there is no
 * `config`. Browser only: the adapter is loaded on demand.
 */
export async function createFeedClient(options: {
  config: FeedConfig | null;
  userId: number;
}): Promise<NotificationFeedClient> {
  const { config, userId } = options;
  if (!config) return createEmptyFeedClient();

  const { createKnockFeedClient } = await import("~/lib/knock-feed-client");
  return createKnockFeedClient({
    ...config,
    userId,
    getToken: () => fetchToken(userId),
  });
}
