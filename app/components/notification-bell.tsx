import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Popover } from "radix-ui";
import {
  Bell,
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  Settings,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  useNotificationFeed,
  type NotificationFeed,
} from "~/components/notification-feed-provider";
import {
  describeNotification,
  formatBadgeCount,
  type NotificationIcon,
} from "~/lib/notification-feed";
import type { FeedNotification } from "~/lib/notification-feed-client";
import { cn, formatRelativeTime } from "~/lib/utils";

const CATEGORY_ICONS: Record<NotificationIcon, LucideIcon> = {
  discussion: MessageSquare,
  refund: Receipt,
  team: UsersRound,
  enrollment: GraduationCap,
  general: Bell,
};

function SenderAvatar({ item, faded }: { item: FeedNotification; faded: boolean }) {
  const className = cn("size-9", faded && "opacity-50");

  if (!item.sender) {
    return (
      <div
        className={cn(
          "flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground",
          faded && "opacity-50"
        )}
        aria-label="Cadence"
      >
        C
      </div>
    );
  }
  return (
    <UserAvatar
      name={item.sender.name}
      avatarUrl={item.sender.avatarUrl}
      className={className}
    />
  );
}

function NotificationRow({
  item,
  onSelect,
  onMarkRead,
}: {
  item: FeedNotification;
  onSelect: () => void;
  onMarkRead: () => void;
}) {
  const { title, snippet, icon } = describeNotification(item);
  const CategoryIcon = CATEGORY_ICONS[icon];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") {
          onSelect();
        }
      }}
      className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <div className="relative shrink-0">
        <SenderAvatar item={item} faded={item.read} />
        <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border border-popover bg-muted text-muted-foreground">
          <CategoryIcon className="size-2.5" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm",
            item.read ? "font-normal text-muted-foreground" : "font-bold"
          )}
        >
          {title}
        </p>
        {snippet && (
          <p className="truncate text-xs text-muted-foreground">{snippet}</p>
        )}
        <p
          className="mt-0.5 text-xs text-muted-foreground/70"
          suppressHydrationWarning
        >
          {formatRelativeTime(item.insertedAt)}
        </p>
      </div>

      {!item.read && (
        <button
          type="button"
          title="Mark as read"
          aria-label="Mark as read"
          onClick={(event) => {
            event.stopPropagation();
            onMarkRead();
          }}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Check className="size-4" />
        </button>
      )}
    </div>
  );
}

function NotificationList({
  feed,
  onSelect,
}: {
  feed: NotificationFeed;
  onSelect: (item: FeedNotification) => void;
}) {
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const { items, nextCursor, loadingMore, loadMoreFailed, loadMore } = feed;

  // Re-observed after every page, so a sentinel still in view loads the next.
  useEffect(() => {
    if (!scrollRoot || !sentinel || !nextCursor || loadMoreFailed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: scrollRoot, rootMargin: "120px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRoot, sentinel, nextCursor, items.length, loadMoreFailed, loadMore]);

  if (feed.status === "loading") {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (feed.status === "error") {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Couldn&apos;t load your notifications.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        You&apos;re all caught up.
      </p>
    );
  }

  return (
    <div ref={setScrollRoot} className="min-h-0 flex-1 overflow-y-auto">
      <div className="divide-y divide-border">
        {items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            onSelect={() => onSelect(item)}
            onMarkRead={() => feed.markRead(item.id)}
          />
        ))}
      </div>
      {nextCursor && (
        <div ref={setSentinel} className="px-4 py-3 text-center">
          {loadMoreFailed ? (
            <button
              type="button"
              onClick={loadMore}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Couldn&apos;t load more. Try again
            </button>
          ) : (
            loadingMore && (
              <span className="text-xs text-muted-foreground">Loading…</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** The bell in the sidebar header, its badge, and the popover beside it. */
export function NotificationBell() {
  const feed = useNotificationFeed();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // The popover sits beside the whole sidebar, not beside the bell inside it.
  const anchorRef = useRef<HTMLElement | null>(null);

  if (!feed) return null;

  const badge = formatBadgeCount(feed.counts.unseen);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Seen is not read: rows stay unread until acted on.
    if (next) feed?.markAllSeen();
  }

  function select(item: FeedNotification) {
    feed?.markRead(item.id);
    // A row with nowhere to go only marks itself read; the popover stays open.
    if (item.link?.startsWith("/")) {
      setOpen(false);
      navigate(item.link);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Anchor virtualRef={anchorRef} />
      <Popover.Trigger asChild>
        <button
          ref={(button) => {
            anchorRef.current = button?.closest("aside") ?? button;
          }}
          type="button"
          title="Notifications"
          aria-label={
            badge
              ? `Notifications, ${feed.counts.unseen} new`
              : "Notifications"
          }
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Bell className="size-5" />
          {badge && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
              {badge}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          alignOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={feed.markAllRead}
                disabled={feed.counts.unread === 0}
                className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent disabled:pointer-events-none disabled:text-muted-foreground"
              >
                Mark all as read
              </button>
              <Link
                to="/settings#notifications"
                title="Notification settings"
                aria-label="Notification settings"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Settings className="size-4" />
              </Link>
            </div>
          </div>

          <NotificationList feed={feed} onSelect={select} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
