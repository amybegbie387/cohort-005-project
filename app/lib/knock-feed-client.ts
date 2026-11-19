import Knock, {
  NetworkStatus,
  type Feed,
  type FeedEventPayload,
  type FeedItem,
} from "@knocklabs/client";
import type {
  FeedCounts,
  FeedNotification,
  FeedPage,
  FeedSender,
  FeedUpdate,
  NotificationFeedClient,
} from "~/lib/notification-feed-client";

// ─── Knock client adapter ───
// The only browser code that knows Knock exists. It maps Knock feed items to
// Cadence's FeedNotification and its socket to `subscribe`. Not covered by
// tests: it is checked by hand against the Development environment.
//
// - Sender comes from the item's actor, which Knock looks up each time the
//   feed loads, so old Notifications pick up avatar changes. A Notification
//   triggered with no actor has none: Cadence itself.
// - `mark all seen` and `mark all read` are Knock's bulk-by-channel updates,
//   so they cover Notifications that are not loaded yet.
// - New Notifications arrive over Knock's socket. Each push causes one fetch of
//   what is newer than the top item; nothing polls.

const PAGE_SIZE = 30;
const REFRESH_TOKEN_BEFORE_EXPIRY_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function toSender(item: FeedItem): FeedSender {
  const actor = item.actors[0];
  if (!actor) return null;
  const { id, name, avatar } = asRecord(actor);
  if (typeof id !== "string") return null;
  return {
    id,
    name: typeof name === "string" && name ? name : "Someone",
    avatarUrl: typeof avatar === "string" && avatar ? avatar : null,
  };
}

function toNotification(item: FeedItem): FeedNotification {
  const data = asRecord(item.data);
  return {
    id: item.id,
    event: item.source.key,
    sender: toSender(item),
    link: typeof data.link === "string" && data.link ? data.link : null,
    data,
    insertedAt: item.inserted_at,
    seen: item.seen_at !== null,
    read: item.read_at !== null,
  };
}

function readCounts(feed: Feed): FeedCounts {
  const { metadata } = feed.getState();
  return { unseen: metadata.unseen_count, unread: metadata.unread_count };
}

export async function createKnockFeedClient(options: {
  publicApiKey: string;
  feedChannelId: string;
  userId: number;
  getToken: () => Promise<string>;
}): Promise<NotificationFeedClient> {
  const { publicApiKey, feedChannelId, userId, getToken } = options;

  const knock = new Knock(publicApiKey, {
    // Stay connected while the tab is hidden, or pushes in that time are lost.
    disconnectOnPageHidden: false,
  });
  knock.authenticate({ id: String(userId) }, await getToken(), {
    onUserTokenExpiring: getToken,
    timeBeforeExpirationInMs: REFRESH_TOKEN_BEFORE_EXPIRY_MS,
    // Cadence syncs users from the server; the browser must not rewrite them.
    identificationStrategy: "skip",
  });

  const feed = knock.feeds.initialize(feedChannelId, { page_size: PAGE_SIZE });
  const listeners = new Set<(update: FeedUpdate) => void>();

  feed.on("items.received.realtime", ({ items }: FeedEventPayload) => {
    if (items.length === 0) return;
    const update: FeedUpdate = {
      items: items.map(toNotification),
      counts: readCounts(feed),
    };
    for (const listener of listeners) listener(update);
  });
  feed.listenForUpdates();

  function loadedItem(id: string) {
    return feed.getState().items.find((item) => item.id === id);
  }

  return {
    async list({ cursor } = {}) {
      const result = await feed.fetch(
        cursor ? { after: cursor, __loadingType: NetworkStatus.fetchMore } : {}
      );
      if (!result || result.status !== "ok") {
        throw new Error("Could not load Notifications");
      }
      const items: FeedItem[] = result.data.entries;
      const page: FeedPage = {
        items: items.map(toNotification),
        nextCursor: result.data.page_info.after ?? null,
        counts: readCounts(feed),
      };
      return page;
    },

    getCounts: () => readCounts(feed),

    async markRead(id) {
      const item = loadedItem(id);
      if (item) await feed.markAsRead(item);
      return readCounts(feed);
    },

    async markAllRead() {
      await feed.markAllAsRead();
      return readCounts(feed);
    },

    async markAllSeen() {
      await feed.markAllAsSeen();
      return readCounts(feed);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    teardown() {
      listeners.clear();
      feed.dispose();
      knock.logout();
    },
  };
}
