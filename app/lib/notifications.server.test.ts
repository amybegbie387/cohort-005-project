import { describe, it, expect, vi } from "vitest";
import {
  NOTIFICATION_EVENT_CATEGORIES,
  createFakeNotifications,
  mergePreferences,
  toNotificationSender,
  toNotificationUser,
} from "./notifications.server";
import { createNotificationsFromEnv } from "./notifications-instance.server";

describe("merging preferences", () => {
  it("changes one category and leaves the others alone", () => {
    expect(
      mergePreferences(
        { enrollments: { feed: false }, "seat-claims": { feed: true } },
        { enrollments: { feed: true } }
      )
    ).toEqual({ enrollments: { feed: true }, "seat-claims": { feed: true } });
  });

  it("starts from nothing for a user with no preferences", () => {
    expect(mergePreferences(null, { enrollments: { feed: false } })).toEqual({
      enrollments: { feed: false },
    });
  });

  it("is what the fake stores", async () => {
    const fake = createFakeNotifications();
    await fake.mergePreferences(1, { enrollments: { feed: false } });
    await fake.mergePreferences(1, { "seat-claims": { feed: false } });

    expect(await fake.getPreferences(1)).toEqual({
      enrollments: { feed: false },
      "seat-claims": { feed: false },
    });
    expect(await fake.getPreferences(2)).toBeNull();
  });
});

describe("describing a user to the Notification service", () => {
  const row = {
    id: 3,
    name: "Dee Student",
    email: "dee@example.com",
    avatarUrl: "/dee.png",
    role: "student",
    passwordHash: "never leaves Cadence",
  };

  it("takes only the recipient's id, name, email and avatar", () => {
    expect(toNotificationUser(row)).toEqual({
      id: 3,
      name: "Dee Student",
      email: "dee@example.com",
      avatarUrl: "/dee.png",
    });
  });

  it("takes only the sender's id, name and avatar, never the email", () => {
    expect(toNotificationSender(row)).toEqual({
      id: 3,
      name: "Dee Student",
      avatarUrl: "/dee.png",
    });
  });
});

describe("the category each event belongs to", () => {
  it("puts the three Refund Request decisions under one switch", () => {
    expect(NOTIFICATION_EVENT_CATEGORIES["refund-confirmed"]).toBe(
      "refund-request-updates"
    );
    expect(NOTIFICATION_EVENT_CATEGORIES["refund-approved"]).toBe(
      "refund-request-updates"
    );
    expect(NOTIFICATION_EVENT_CATEGORIES["refund-declined"]).toBe(
      "refund-request-updates"
    );
  });

  it("gives every other event its own switch", () => {
    expect(NOTIFICATION_EVENT_CATEGORIES["refund-opened"]).toBe(
      "open-refund-requests"
    );
    expect(NOTIFICATION_EVENT_CATEGORIES["seat-claimed"]).toBe("seat-claims");
    expect(NOTIFICATION_EVENT_CATEGORIES["enrollment-created"]).toBe(
      "enrollments"
    );
    expect(NOTIFICATION_EVENT_CATEGORIES["discussion-question-asked"]).toBe(
      "discussion-questions"
    );
    expect(NOTIFICATION_EVENT_CATEGORIES["discussion-reply-posted"]).toBe(
      "discussion-replies"
    );
  });
});
describe("choosing an adapter from the environment", () => {
  it("uses the logging no-op when there is no secret key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const notifications = createNotificationsFromEnv({});
    await notifications.archiveForComment(7);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("archive notifications for comment 7")
    );
    log.mockRestore();
  });
});
