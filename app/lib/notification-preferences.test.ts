import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import { visibleNotificationCategories } from "./notification-preferences";

const nobody = {
  role: UserRole.Student,
  hasPurchase: false,
  boughtTeamLicence: false,
  teachesACourse: false,
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

  it("shows Seat claims to anyone who bought a Team Licence, even a Student", () => {
    expect(
      visibleNotificationCategories({ ...nobody, boughtTeamLicence: true })
    ).toEqual(["seat-claims", "discussion-replies"]);
  });

  it("shows Enrollments and Discussion Questions to anyone who teaches a course", () => {
    expect(
      visibleNotificationCategories({ ...nobody, teachesACourse: true })
    ).toEqual(["enrollments", "discussion-questions", "discussion-replies"]);
  });

  it("shows Open Refund Requests to a Platform Admin", () => {
    expect(
      visibleNotificationCategories({ ...nobody, role: UserRole.Admin })
    ).toEqual(["open-refund-requests", "discussion-replies"]);
  });

  it("does not show Seat claims or Refund Request updates to someone who only teaches", () => {
    const categories = visibleNotificationCategories({
      ...nobody,
      teachesACourse: true,
    });

    expect(categories).not.toContain("seat-claims");
    expect(categories).not.toContain("refund-request-updates");
  });

  it("shows every switch to an Instructor who bought a Team Licence", () => {
    expect(
      visibleNotificationCategories({
        role: UserRole.Instructor,
        hasPurchase: true,
        boughtTeamLicence: true,
        teachesACourse: true,
      })
    ).toEqual([
      "refund-request-updates",
      "seat-claims",
      "enrollments",
      "discussion-questions",
      "discussion-replies",
    ]);
  });

  it("shows Enrollments and Discussion Questions to a Student who is the Instructor of a course", () => {
    expect(
      visibleNotificationCategories({ ...nobody, teachesACourse: true })
    ).toContain("enrollments");
  });

  it("still shows them to an Instructor who has no course yet", () => {
    expect(
      visibleNotificationCategories({ ...nobody, role: UserRole.Instructor })
    ).toEqual(["enrollments", "discussion-questions", "discussion-replies"]);
  });
});
