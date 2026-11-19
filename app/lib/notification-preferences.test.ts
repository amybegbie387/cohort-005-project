import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import { visibleNotificationCategories } from "./notification-preferences";

const nobody = {
  role: UserRole.Student,
  hasPurchase: false,
  isTeamAdmin: false,
};

describe("visibleNotificationCategories", () => {
  it("shows only Discussion Replies to a Student with no Purchase", () => {
    expect(visibleNotificationCategories(nobody)).toEqual([
      "discussion-replies",
    ]);
  });

  it("shows Refund Request updates to anyone with a Purchase", () => {
    expect(
      visibleNotificationCategories({ ...nobody, hasPurchase: true })
    ).toEqual(["refund-request-updates", "discussion-replies"]);
  });

  it("shows Seat claims to a Team Admin, even a Student", () => {
    expect(
      visibleNotificationCategories({ ...nobody, isTeamAdmin: true })
    ).toEqual(["seat-claims", "discussion-replies"]);
  });

  it("shows Enrollments and Discussion Questions to an Instructor", () => {
    expect(
      visibleNotificationCategories({ ...nobody, role: UserRole.Instructor })
    ).toEqual(["enrollments", "discussion-questions", "discussion-replies"]);
  });

  it("shows Open Refund Requests to a Platform Admin", () => {
    expect(
      visibleNotificationCategories({ ...nobody, role: UserRole.Admin })
    ).toEqual(["open-refund-requests", "discussion-replies"]);
  });

  it("does not show Seat claims or Refund Request updates by role alone", () => {
    const categories = visibleNotificationCategories({
      ...nobody,
      role: UserRole.Instructor,
    });

    expect(categories).not.toContain("seat-claims");
    expect(categories).not.toContain("refund-request-updates");
  });

  it("shows every switch to an Instructor who bought a Team Licence and is a Team Admin", () => {
    expect(
      visibleNotificationCategories({
        role: UserRole.Instructor,
        hasPurchase: true,
        isTeamAdmin: true,
      })
    ).toEqual([
      "refund-request-updates",
      "seat-claims",
      "enrollments",
      "discussion-questions",
      "discussion-replies",
    ]);
  });
});
