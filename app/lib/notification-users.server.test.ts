import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  createFakeNotifications,
  type FakeNotifications,
  type NotificationService,
} from "./notifications.server";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  syncAllUsers,
  syncNotificationUser,
} from "./notification-users.server";

const alex = {
  id: 7,
  name: "Alex Rivera",
  email: "alex@example.com",
  avatarUrl: "https://example.com/alex.png",
  role: UserRole.Admin,
};

let notifications: FakeNotifications;

beforeEach(() => {
  notifications = createFakeNotifications();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("syncNotificationUser", () => {
  it("sends the user's name, email and avatar and nothing else", async () => {
    await syncNotificationUser(notifications, alex);

    expect(notifications.syncedUsers).toEqual([
      {
        id: 7,
        name: "Alex Rivera",
        email: "alex@example.com",
        avatarUrl: "https://example.com/alex.png",
      },
    ]);
  });

  it("sends a missing avatar as null", async () => {
    await syncNotificationUser(notifications, { ...alex, avatarUrl: null });

    expect(notifications.syncedUsers[0]?.avatarUrl).toBeNull();
  });

  it("writes Enrollments off and everything else on, for the feed only, to a user with no preferences", async () => {
    await syncNotificationUser(notifications, alex);

    expect(await notifications.getPreferences(7)).toEqual({
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: false },
      "discussion-questions": { feed: true },
      "discussion-replies": { feed: true },
    });
  });

  it("never overwrites the preferences a user already has", async () => {
    await notifications.mergePreferences(7, {
      "discussion-replies": { feed: false },
      enrollments: { feed: true },
    });
    notifications.preferenceWrites.length = 0;

    await syncNotificationUser(notifications, alex);

    expect(notifications.preferenceWrites).toEqual([]);
    expect(await notifications.getPreferences(7)).toEqual({
      "discussion-replies": { feed: false },
      enrollments: { feed: true },
    });
  });

  it("keeps a user's choices through a second sync", async () => {
    await syncNotificationUser(notifications, alex);
    await notifications.mergePreferences(7, { "seat-claims": { feed: false } });

    await syncNotificationUser(notifications, { ...alex, name: "Alex R." });

    expect((await notifications.getPreferences(7))?.["seat-claims"]).toEqual({
      feed: false,
    });
    expect(notifications.syncedUsers.at(-1)?.name).toBe("Alex R.");
  });

  it("reports success", async () => {
    expect(await syncNotificationUser(notifications, alex)).toBe(true);
  });

  it("logs and reports a failed sync instead of throwing", async () => {
    const failing: NotificationService = {
      ...notifications,
      syncUser: () => Promise.reject(new Error("vendor down")),
    };

    await expect(syncNotificationUser(failing, alex)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("logs and reports a sync that throws synchronously", async () => {
    const failing: NotificationService = {
      ...notifications,
      syncUser: () => {
        throw new Error("vendor down");
      },
    };

    await expect(syncNotificationUser(failing, alex)).resolves.toBe(false);
  });

  it("logs and reports a failed preference read or write", async () => {
    const failing: NotificationService = {
      ...notifications,
      getPreferences: () => Promise.reject(new Error("vendor down")),
    };

    await expect(syncNotificationUser(failing, alex)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("DEFAULT_NOTIFICATION_PREFERENCES", () => {
  it("turns off only Enrollments", () => {
    const off = Object.entries(DEFAULT_NOTIFICATION_PREFERENCES)
      .filter(([, channels]) => channels?.feed === false)
      .map(([category]) => category);

    expect(off).toEqual(["enrollments"]);
  });
});

describe("syncAllUsers", () => {
  it("syncs every user in the database and counts them", async () => {
    const db = createTestDb();
    db.insert(schema.users)
      .values([
        { name: "A", email: "a@example.com", role: UserRole.Student },
        { name: "B", email: "b@example.com", role: UserRole.Instructor },
      ])
      .run();

    const result = await syncAllUsers(db, notifications);

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(notifications.syncedUsers.map((user) => user.email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("carries on past a user that fails and counts the failure", async () => {
    const db = createTestDb();
    db.insert(schema.users)
      .values([
        { name: "A", email: "a@example.com", role: UserRole.Student },
        { name: "B", email: "b@example.com", role: UserRole.Student },
      ])
      .run();
    const flaky: NotificationService = {
      ...notifications,
      syncUser: (user) =>
        user.email === "a@example.com"
          ? Promise.reject(new Error("vendor down"))
          : notifications.syncUser(user),
    };

    const result = await syncAllUsers(db, flaky);

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(notifications.syncedUsers.map((user) => user.email)).toEqual([
      "b@example.com",
    ]);
  });
});
