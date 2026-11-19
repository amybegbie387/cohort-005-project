import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  createFeedClient,
  type FeedConfig,
  type FeedCounts,
  type FeedNotification,
  type NotificationFeedClient,
} from "~/lib/notification-feed-client";

// Owns the one Feed connection for the signed-in user and the state the bell
// and popover render. It only ever talks to NotificationFeedClient.

export type FeedStatus = "loading" | "ready" | "error";

type FeedState = {
  items: FeedNotification[];
  counts: FeedCounts;
  nextCursor: string | null;
  status: FeedStatus;
  loadingMore: boolean;
  loadMoreFailed: boolean;
};

const INITIAL_STATE: FeedState = {
  items: [],
  counts: { unseen: 0, unread: 0 },
  nextCursor: null,
  status: "loading",
  loadingMore: false,
  loadMoreFailed: false,
};

export type NotificationFeed = FeedState & {
  markRead(id: string): void;
  markAllRead(): void;
  markAllSeen(): void;
  loadMore(): void;
};

const NotificationFeedContext = createContext<NotificationFeed | null>(null);

/** `null` outside a provider, so the bell can simply not render. */
export function useNotificationFeed(): NotificationFeed | null {
  return useContext(NotificationFeedContext);
}

function addNewest(
  existing: FeedNotification[],
  arrived: FeedNotification[]
): FeedNotification[] {
  const known = new Set(existing.map((item) => item.id));
  return [...arrived.filter((item) => !known.has(item.id)), ...existing];
}

function addOlder(
  existing: FeedNotification[],
  older: FeedNotification[]
): FeedNotification[] {
  const known = new Set(existing.map((item) => item.id));
  return [...existing, ...older.filter((item) => !known.has(item.id))];
}

export function NotificationFeedProvider({
  userId,
  config,
  children,
}: {
  userId: number | null;
  config: FeedConfig | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<FeedState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const clientRef = useRef<NotificationFeedClient | null>(null);

  const publicApiKey = config?.publicApiKey ?? null;
  const feedChannelId = config?.feedChannelId ?? null;

  // One connection per signed-in user. When the user changes (the DevUI
  // switcher), the effect's cleanup tears the old one down and this connects
  // again with a token signed for the new user.
  useEffect(() => {
    setState(INITIAL_STATE);
    if (userId === null) return;

    let cancelled = false;
    let client: NotificationFeedClient | null = null;
    let unsubscribe = () => {};

    async function connect(currentUserId: number) {
      try {
        const created = await createFeedClient({
          config:
            publicApiKey && feedChannelId ? { publicApiKey, feedChannelId } : null,
          userId: currentUserId,
        });
        if (cancelled) {
          created.teardown();
          return;
        }
        client = created;
        clientRef.current = created;

        unsubscribe = created.subscribe((update) => {
          setState((current) => ({
            ...current,
            items: addNewest(current.items, update.items),
            counts: update.counts,
          }));
        });

        const page = await created.list();
        if (cancelled) return;
        setState({
          ...INITIAL_STATE,
          items: page.items,
          counts: page.counts,
          nextCursor: page.nextCursor,
          status: "ready",
        });
      } catch (error) {
        if (cancelled) return;
        console.error("[notifications] could not connect the Feed", error);
        setState({ ...INITIAL_STATE, status: "error" });
      }
    }

    void connect(userId);

    return () => {
      cancelled = true;
      unsubscribe();
      client?.teardown();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [userId, publicApiKey, feedChannelId]);

  const reload = useCallback(async (failed: string) => {
    toast.error(failed);
    const client = clientRef.current;
    if (!client) return;
    try {
      const page = await client.list();
      if (clientRef.current !== client) return;
      setState({
        ...INITIAL_STATE,
        items: page.items,
        counts: page.counts,
        nextCursor: page.nextCursor,
        status: "ready",
      });
    } catch {
      // Keep what is on screen; the toast has said it.
    }
  }, []);

  const markRead = useCallback(
    (id: string) => {
      const client = clientRef.current;
      const item = stateRef.current.items.find((entry) => entry.id === id);
      if (!client || !item || item.read) return;

      setState((current) => ({
        ...current,
        items: current.items.map((entry) =>
          entry.id === id ? { ...entry, read: true } : entry
        ),
        counts: {
          ...current.counts,
          unread: Math.max(0, current.counts.unread - 1),
        },
      }));
      client
        .markRead(id)
        .catch(() => reload("Couldn't mark the notification as read."));
    },
    [reload]
  );

  const markAllRead = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;

    setState((current) => ({
      ...current,
      items: current.items.map((entry) => ({ ...entry, read: true })),
      counts: { ...current.counts, unread: 0 },
    }));
    client
      .markAllRead()
      .catch(() => reload("Couldn't mark all notifications as read."));
  }, [reload]);

  const markAllSeen = useCallback(() => {
    const client = clientRef.current;
    if (!client || stateRef.current.counts.unseen === 0) return;

    setState((current) => ({
      ...current,
      items: current.items.map((entry) => ({ ...entry, seen: true })),
      counts: { ...current.counts, unseen: 0 },
    }));
    client
      .markAllSeen()
      .catch(() => reload("Couldn't update your notifications."));
  }, [reload]);

  const loadMore = useCallback(() => {
    const client = clientRef.current;
    const { nextCursor, loadingMore, status } = stateRef.current;
    if (!client || !nextCursor || loadingMore || status !== "ready") return;

    setState((current) => ({
      ...current,
      loadingMore: true,
      loadMoreFailed: false,
    }));
    client
      .list({ cursor: nextCursor })
      .then((page) => {
        if (clientRef.current !== client) return;
        setState((current) => ({
          ...current,
          items: addOlder(current.items, page.items),
          counts: page.counts,
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      })
      .catch(() => {
        if (clientRef.current !== client) return;
        setState((current) => ({
          ...current,
          loadingMore: false,
          loadMoreFailed: true,
        }));
      });
  }, []);

  const value = useMemo<NotificationFeed>(
    () => ({ ...state, markRead, markAllRead, markAllSeen, loadMore }),
    [state, markRead, markAllRead, markAllSeen, loadMore]
  );

  return (
    <NotificationFeedContext.Provider value={value}>
      {children}
    </NotificationFeedContext.Provider>
  );
}
