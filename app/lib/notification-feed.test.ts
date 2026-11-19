import { describe, it, expect } from "vitest";
import { describeNotification, formatBadgeCount } from "./notification-feed";
import type { NotificationEvent } from "./notifications.server";

const priya = { id: 7, name: "Priya Shah", avatarUrl: null };

describe("a Discussion row", () => {
  it("says who asked and in which lesson, with the comment as the snippet", () => {
    expect(
      describeNotification({
        event: "discussion-question-asked",
        sender: priya,
        data: {
          lessonTitle: "Narrowing",
          courseTitle: "Advanced TypeScript",
          snippet: "Why does `in` not narrow here?",
        },
      })
    ).toEqual({
      title: "Priya Shah asked a question in Narrowing",
      snippet: "Why does `in` not narrow here?",
      icon: "discussion",
    });
  });

  it("says who replied, and falls back to the lesson when there is no snippet", () => {
    expect(
      describeNotification({
        event: "discussion-reply-posted",
        sender: priya,
        data: { lessonTitle: "Narrowing", courseTitle: "Advanced TypeScript" },
      })
    ).toEqual({
      title: "Priya Shah replied to your question",
      snippet: "Narrowing · Advanced TypeScript",
      icon: "discussion",
    });
  });
});

describe("a Refund Request row", () => {
  const course = {
    courseTitle: "Advanced TypeScript",
    amount: 14900,
    purchaseId: 42,
  };

  it("confirms to the buyer with the course and amount, under review", () => {
    expect(
      describeNotification({
        event: "refund-confirmed",
        sender: null,
        data: course,
      })
    ).toEqual({
      title: "Your Refund Request was submitted",
      snippet: "Advanced TypeScript · $149.00 · Under review",
      icon: "refund",
    });
  });

  it("tells the buyer who approved, with the course, Purchase and decision note", () => {
    expect(
      describeNotification({
        event: "refund-approved",
        sender: { name: "Ada Admin" },
        data: { ...course, decisionNote: "No problem at all." },
      })
    ).toEqual({
      title: "Ada Admin approved your Refund Request",
      snippet: "Advanced TypeScript · Purchase #42 · No problem at all.",
      icon: "refund",
    });
  });

  it("leaves the decision note out of an approval that has none", () => {
    expect(
      describeNotification({
        event: "refund-approved",
        sender: { name: "Ada Admin" },
        data: { ...course, decisionNote: null },
      }).snippet
    ).toBe("Advanced TypeScript · Purchase #42");
  });

  it("tells the buyer who declined, with the decision note and that they can ask again", () => {
    expect(
      describeNotification({
        event: "refund-declined",
        sender: { name: "Ada Admin" },
        data: { ...course, decisionNote: "Outside the window." },
      })
    ).toEqual({
      title: "Ada Admin declined your Refund Request",
      snippet: "Outside the window. · You can ask again",
      icon: "refund",
    });
  });

  it("names the course on a decline that has no note", () => {
    expect(
      describeNotification({
        event: "refund-declined",
        sender: { name: "Ada Admin" },
        data: { ...course, decisionNote: null },
      }).snippet
    ).toBe("Advanced TypeScript · You can ask again");
  });

  it("tells a Platform Admin who is waiting, with the course, amount and reason", () => {
    expect(
      describeNotification({
        event: "refund-opened",
        sender: { name: "Bea Buyer" },
        data: { ...course, reason: "Not what I expected." },
      })
    ).toEqual({
      title: "Bea Buyer requested a refund",
      snippet: "Advanced TypeScript · $149.00 · Not what I expected.",
      icon: "refund",
    });
  });
});

describe("a Team or Enrollment row", () => {
  it("says who claimed a seat and how many are left", () => {
    expect(
      describeNotification({
        event: "seat-claimed",
        sender: { name: "Cy Claimer" },
        data: { courseTitle: "Advanced TypeScript", seatsRemaining: 3 },
      })
    ).toEqual({
      title: "Cy Claimer claimed a seat",
      snippet: "Advanced TypeScript · 3 seats left",
      icon: "team",
    });
  });

  it("uses the singular for the last seat", () => {
    expect(
      describeNotification({
        event: "seat-claimed",
        sender: { name: "Cy Claimer" },
        data: { courseTitle: "Advanced TypeScript", seatsRemaining: 1 },
      }).snippet
    ).toBe("Advanced TypeScript · 1 seat left");
  });

  it("says who enrolled", () => {
    expect(
      describeNotification({
        event: "enrollment-created",
        sender: { name: "Dee Student" },
        data: { courseTitle: "Advanced TypeScript" },
      })
    ).toEqual({
      title: "Dee Student enrolled in your course",
      snippet: "Advanced TypeScript",
      icon: "enrollment",
    });
  });
});

describe("a row Cadence does not recognise", () => {
  it("still renders something readable", () => {
    expect(
      describeNotification({
        event: "mystery" as NotificationEvent,
        sender: null,
        data: {},
      })
    ).toEqual({ title: "New notification", snippet: "", icon: "general" });
  });
});

describe("the bell badge", () => {
  it("shows nothing when there is nothing unseen", () => {
    expect(formatBadgeCount(0)).toBeNull();
  });

  it("shows the count up to 9", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(9)).toBe("9");
  });

  it("caps at 9+", () => {
    expect(formatBadgeCount(10)).toBe("9+");
    expect(formatBadgeCount(250)).toBe("9+");
  });
});
