import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { enrollUser } from "./enrollments.server";
import {
  createFakeNotifications,
  type FakeNotifications,
  type NotificationService,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  notifications = createFakeNotifications();
  db = createTestDb();
  base = seedBaseData(db);
});

function enrollmentsOf(userId: number) {
  return db
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, userId))
    .all();
}

describe("enrolling a user", () => {
  it("enrolls the user in the course", () => {
    const enrollment = enrollUser(
      db,
      base.user.id,
      base.course.id,
      notifications
    );

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("refuses a user who is already enrolled, leaving one Enrollment", () => {
    enrollUser(db, base.user.id, base.course.id, notifications);

    expect(() =>
      enrollUser(db, base.user.id, base.course.id, notifications)
    ).toThrow("User is already enrolled in this course");
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("refuses a course that does not exist", () => {
    expect(() => enrollUser(db, base.user.id, 9999, notifications)).toThrow(
      "Course not found"
    );
    expect(enrollmentsOf(base.user.id)).toHaveLength(0);
  });
});

describe("notifying the Instructor of a new Enrollment", () => {
  it("tells the Instructor which Student enrolled in which course", () => {
    const enrollment = enrollUser(
      db,
      base.user.id,
      base.course.id,
      notifications
    );

    expect(notifications.triggers).toEqual([
      {
        event: "enrollment-created",
        category: "enrollments",
        recipient: {
          id: base.instructor.id,
          name: "Test Instructor",
          email: "instructor@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `enrollment-created:${enrollment.id}`,
        data: {
          sender: { id: base.user.id, name: "Test User", avatarUrl: null },
          link: `/instructor/${base.course.id}/students`,
          courseId: base.course.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
        },
      },
    ]);
  });

  it("sends the Student's real avatar", () => {
    db.update(schema.users)
      .set({ avatarUrl: "https://example.com/test.png" })
      .where(eq(schema.users.id, base.user.id))
      .run();

    enrollUser(db, base.user.id, base.course.id, notifications);

    expect(notifications.triggers[0].data.sender).toEqual({
      id: base.user.id,
      name: "Test User",
      avatarUrl: "https://example.com/test.png",
    });
  });

  it("notifies again when a Lapsed Student enrolls again", () => {
    const lesson = db
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "M", position: 1 })
      .returning()
      .get();
    const lessonRow = db
      .insert(schema.lessons)
      .values({ moduleId: lesson.id, title: "L", position: 1 })
      .returning()
      .get();
    const first = enrollUser(db, base.user.id, base.course.id, notifications);
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonRow.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();
    db.delete(schema.enrollments)
      .where(eq(schema.enrollments.id, first.id))
      .run();

    const second = enrollUser(db, base.user.id, base.course.id, notifications);

    expect(notifications.triggers.map((t) => t.idempotencyKey)).toEqual([
      `enrollment-created:${first.id}`,
      `enrollment-created:${second.id}`,
    ]);
  });

  it("notifies nobody when the Instructor enrolls on their own course", () => {
    enrollUser(db, base.instructor.id, base.course.id, notifications);

    expect(notifications.triggers).toEqual([]);
  });

  it("notifies nobody when the enrollment is refused", () => {
    enrollUser(db, base.user.id, base.course.id, notifications);
    notifications.triggers.length = 0;

    expect(() =>
      enrollUser(db, base.user.id, base.course.id, notifications)
    ).toThrow();
    expect(notifications.triggers).toEqual([]);
  });

  it("still enrolls the Student when the trigger fails", () => {
    const failing: NotificationService = {
      ...notifications,
      trigger: () => Promise.reject(new Error("vendor down")),
    };

    enrollUser(db, base.user.id, base.course.id, failing);

    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("still enrolls the Student when the trigger throws synchronously", () => {
    const failing: NotificationService = {
      ...notifications,
      trigger: () => {
        throw new Error("vendor down");
      },
    };

    enrollUser(db, base.user.id, base.course.id, failing);

    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });
});
