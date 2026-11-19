import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { TeamMemberRole, UserRole } from "~/db/schema";
import {
  createFakeNotifications,
  type FakeNotifications,
  type NotificationService,
} from "./notifications.server";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notification-users.server";
import {
  getNotificationSwitches,
  saveNotificationSwitch,
} from "./notification-preferences.server";

let db: ReturnType<typeof createTestDb>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  notifications = createFakeNotifications();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function addUser(role: UserRole) {
  return db
    .insert(schema.users)
    .values({
      name: `A ${role}`,
      email: `${role}-${Math.random()}@example.com`,
      role,
    })
    .returning()
    .get();
}

function addPurchase(userId: number) {
  const category = db
    .insert(schema.categories)
    .values({ name: "Dev", slug: `dev-${Math.random()}` })
    .returning()
    .get();
  const instructor = addUser(UserRole.Instructor);
  const course = db
    .insert(schema.courses)
    .values({
      title: "A course",
      slug: `course-${Math.random()}`,
      description: "About it",
      salesCopy: "Buy it",
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
  db.insert(schema.purchases)
    .values({ userId, courseId: course.id, amountPaid: 1000 })
    .run();
}

function makeTeamAdmin(userId: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .run();
}

describe("saveNotificationSwitch", () => {
  it("writes only the flipped category to the feed channel", async () => {
    await saveNotificationSwitch(notifications, 5, "seat-claims", false);

    expect(notifications.preferenceWrites).toEqual([
      { userId: 5, changes: { "seat-claims": { feed: false } } },
    ]);
  });

  it("leaves the person's other choices untouched", async () => {
    await notifications.mergePreferences(5, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
    });

    await saveNotificationSwitch(notifications, 5, "seat-claims", false);

    expect(await notifications.getPreferences(5)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
      "seat-claims": { feed: false },
    });
  });

  it("can switch a category back on", async () => {
    await saveNotificationSwitch(notifications, 5, "enrollments", true);
    await saveNotificationSwitch(notifications, 5, "enrollments", false);
    await saveNotificationSwitch(notifications, 5, "enrollments", true);

    expect((await notifications.getPreferences(5))?.enrollments).toEqual({
      feed: true,
    });
  });

  it("throws when the save fails, so the caller can tell the person", async () => {
    const failing: NotificationService = {
      ...notifications,
      async mergePreferences() {
        throw new Error("vendor down");
      },
    };

    await expect(
      saveNotificationSwitch(failing, 5, "seat-claims", false)
    ).rejects.toThrow("vendor down");
  });
});

describe("getNotificationSwitches", () => {
  it("shows a new Student only Discussion Replies, on", async () => {
    const student = addUser(UserRole.Student);

    expect(await getNotificationSwitches(db, notifications, student.id)).toEqual([
      { category: "discussion-replies", label: "Discussion Replies", enabled: true },
    ]);
  });

  it("shows an Instructor Enrollments off by default and Discussion Questions on", async () => {
    const instructor = addUser(UserRole.Instructor);

    expect(await getNotificationSwitches(db, notifications, instructor.id)).toEqual([
      { category: "enrollments", label: "Enrollments", enabled: false },
      { category: "discussion-questions", label: "Discussion Questions", enabled: true },
      { category: "discussion-replies", label: "Discussion Replies", enabled: true },
    ]);
  });

  it("reveals Refund Request updates already on after a first Purchase", async () => {
    const student = addUser(UserRole.Student);
    await notifications.mergePreferences(student.id, DEFAULT_NOTIFICATION_PREFERENCES);
    await saveNotificationSwitch(notifications, student.id, "discussion-replies", false);

    addPurchase(student.id);

    expect(await getNotificationSwitches(db, notifications, student.id)).toEqual([
      { category: "refund-request-updates", label: "Refund Request updates", enabled: true },
      { category: "discussion-replies", label: "Discussion Replies", enabled: false },
    ]);
  });

  it("shows Seat claims to a Student who is a Team Admin, with the saved value", async () => {
    const student = addUser(UserRole.Student);
    makeTeamAdmin(student.id);
    await saveNotificationSwitch(notifications, student.id, "seat-claims", false);

    const switches = await getNotificationSwitches(db, notifications, student.id);

    expect(switches.find((s) => s.category === "seat-claims")).toEqual({
      category: "seat-claims",
      label: "Seat claims",
      enabled: false,
    });
  });

  it("shows Open Refund Requests to a Platform Admin", async () => {
    const admin = addUser(UserRole.Admin);

    const switches = await getNotificationSwitches(db, notifications, admin.id);

    expect(switches.map((s) => s.category)).toEqual([
      "open-refund-requests",
      "discussion-replies",
    ]);
  });

  it("shows the defaults when the preferences cannot be read", async () => {
    const instructor = addUser(UserRole.Instructor);
    const unreadable: NotificationService = {
      ...notifications,
      async getPreferences() {
        throw new Error("vendor down");
      },
    };

    const switches = await getNotificationSwitches(db, unreadable, instructor.id);

    expect(switches.map((s) => [s.category, s.enabled])).toEqual([
      ["enrollments", false],
      ["discussion-questions", true],
      ["discussion-replies", true],
    ]);
  });
});
