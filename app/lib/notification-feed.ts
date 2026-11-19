// ─── Notification Feed (pure helpers) ───
// What the Feed shows, worked out from a Notification's event and data. Safe
// for the browser: no vendor, no server imports.

import { formatPrice } from "~/lib/utils";

const MAX_BADGE = 9;

/** The text in the bell's badge, or `null` when there is nothing to show. */
export function formatBadgeCount(unseen: number): string | null {
  if (unseen <= 0) return null;
  return unseen > MAX_BADGE ? `${MAX_BADGE}+` : String(unseen);
}

export type NotificationIcon =
  | "discussion"
  | "refund"
  | "team"
  | "enrollment"
  | "general";

export type NotificationRowText = {
  title: string;
  snippet: string;
  icon: NotificationIcon;
};

type RowInput = {
  event: string;
  sender: { name: string } | null;
  data: Record<string, unknown>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinContext(...parts: unknown[]): string {
  return parts.map(text).filter(Boolean).join(" · ");
}

/**
 * The words on a Feed row. Cadence writes them from the event and its data;
 * nothing comes from a vendor template.
 */
export function describeNotification({
  event,
  sender,
  data,
}: RowInput): NotificationRowText {
  const who = sender?.name ?? "Someone";

  switch (event) {
    case "discussion-question-asked":
      return {
        title: `${who} asked a question`,
        snippet:
          text(data.snippet) || joinContext(data.lessonTitle, data.courseTitle),
        icon: "discussion",
      };
    case "discussion-reply-posted":
      return {
        title: `${who} replied to your question`,
        snippet:
          text(data.snippet) || joinContext(data.lessonTitle, data.courseTitle),
        icon: "discussion",
      };
    case "refund-confirmed":
      return {
        title: "Your Refund Request was submitted",
        snippet: text(data.courseTitle),
        icon: "refund",
      };
    case "refund-approved":
      return {
        title: `${who} approved your Refund Request`,
        snippet: text(data.decisionNote) || text(data.courseTitle),
        icon: "refund",
      };
    case "refund-declined":
      return {
        title: `${who} declined your Refund Request`,
        snippet: text(data.decisionNote) || text(data.courseTitle),
        icon: "refund",
      };
    case "refund-opened":
      return {
        title: `${who} requested a refund`,
        snippet: joinContext(
          data.courseTitle,
          typeof data.amount === "number" ? formatPrice(data.amount) : null
        ),
        icon: "refund",
      };
    case "seat-claimed": {
      const seats = data.seatsRemaining;
      return {
        title: `${who} claimed a seat`,
        snippet: joinContext(
          data.courseTitle,
          typeof seats === "number"
            ? `${seats} ${seats === 1 ? "seat" : "seats"} left`
            : null
        ),
        icon: "team",
      };
    }
    case "enrollment-created":
      return {
        title: `${who} enrolled in your course`,
        snippet: text(data.courseTitle),
        icon: "enrollment",
      };
    default:
      return { title: "New notification", snippet: "", icon: "general" };
  }
}
