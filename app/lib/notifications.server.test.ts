import { describe, it, expect, vi } from "vitest";
import {
  createFakeNotifications,
  mergePreferences,
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
