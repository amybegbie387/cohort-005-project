import { describe, it, expect } from "vitest";
import { describeNotification, formatBadgeCount } from "./notification-feed";

const priya = { id: 7, name: "Priya Shah", avatarUrl: null };

describe("a Discussion row", () => {
  it("says who asked, with the comment as the snippet", () => {
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
      title: "Priya Shah asked a question",
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
  const course = { courseTitle: "Advanced TypeScript", amount: 14900 };

  it("confirms to the buyer with no sender", () => {
    expect(
      describeNotification({
        event: "refund-confirmed",
        sender: null,
        data: course,
      })
    ).toEqual({
      title: "Your Refund Request was submitted",
      snippet: "Advanced TypeScript",
      icon: "refund",
    });
  });

  it("tells the buyer who approved, with the decision note when there is one", () => {
    expect(
      describeNotification({
        event: "refund-approved",
        sender: { name: "Ada Admin" },
        data: { ...course, decisionNote: "No problem at all." },
      })
    ).toEqual({
      title: "Ada Admin approved your Refund Request",
      snippet: "No problem at all.",
      icon: "refund",
    });
  });

  it("tells the buyer who declined, falling back to the course", () => {
    expect(
      describeNotification({
        event: "refund-declined",
        sender: { name: "Ada Admin" },
        data: { ...course, decisionNote: null },
      })
    ).toEqual({
      title: "Ada Admin declined your Refund Request",
      snippet: "Advanced TypeScript",
      icon: "refund",
    });
  });

  it("tells a Platform Admin who is waiting, with the course and amount", () => {
    expect(
      describeNotification({
        event: "refund-opened",
        sender: { name: "Bea Buyer" },
        data: course,
      })
    ).toEqual({
      title: "Bea Buyer requested a refund",
      snippet: "Advanced TypeScript · $149.00",
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
      describeNotification({ event: "mystery", sender: null, data: {} })
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
