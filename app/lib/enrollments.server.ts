// ─── Enrollments (server) ───
// Creating an Enrollment. Every Enrollment row is written by `createEnrollment`;
// `enrollUser` (Individual Purchase) and `claimSeat` (seat-claims.server.ts)
// are the two paths that reach it, and where anything that follows a new
// Enrollment belongs. Both tell the course's Instructor through
// `notifyInstructorOfEnrollment`. A Team Licence purchase enrolls nobody, so it
// never reaches either.

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  triggerSafely,
  type NotificationService,
} from "~/lib/notifications.server";

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const { courses, enrollments, users } = schema;

export function findEnrollment(
  db: Db | Tx,
  userId: number,
  courseId: number
) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

export function isUserEnrolled(db: Db | Tx, userId: number, courseId: number) {
  return !!findEnrollment(db, userId, courseId);
}

/** The only place an Enrollment row is written. Does no checking. */
export function createEnrollment(db: Db | Tx, userId: number, courseId: number) {
  return db
    .insert(enrollments)
    .values({ userId, courseId })
    .returning()
    .get();
}

/**
 * Enrolls a user in a course (Individual Purchase) and tells the Instructor.
 * Throws an Error for anything the user can fix.
 */
export function enrollUser(
  db: Db,
  userId: number,
  courseId: number,
  notifications: NotificationService
) {
  if (isUserEnrolled(db, userId, courseId)) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) {
    throw new Error("Course not found");
  }

  const enrollment = createEnrollment(db, userId, courseId);

  // The Enrollment has committed. Nothing below may undo it.
  notifyInstructorOfEnrollment(db, enrollment, notifications);

  return enrollment;
}

/**
 * Tells the course's Instructor a Student enrolled. A Lapsed Student enrolling
 * again is a new Enrollment, so it notifies like any other. Call it after the
 * Enrollment has committed.
 */
export function notifyInstructorOfEnrollment(
  db: Db,
  enrollment: typeof enrollments.$inferSelect,
  notifications: NotificationService
) {
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, enrollment.courseId))
    .get();
  // Nobody is told about their own enrollment.
  if (!course || course.instructorId === enrollment.userId) return;

  const instructor = db
    .select()
    .from(users)
    .where(eq(users.id, course.instructorId))
    .get();
  const student = db
    .select()
    .from(users)
    .where(eq(users.id, enrollment.userId))
    .get();
  if (!instructor || !student) return;

  triggerSafely(notifications, {
    event: "enrollment-created",
    category: "enrollments",
    recipient: {
      id: instructor.id,
      name: instructor.name,
      email: instructor.email,
      avatarUrl: instructor.avatarUrl,
    },
    idempotencyKey: `enrollment-created:${enrollment.id}`,
    data: {
      sender: {
        id: student.id,
        name: student.name,
        avatarUrl: student.avatarUrl,
      },
      link: `/instructor/${course.id}/students`,
      courseId: course.id,
      courseTitle: course.title,
      courseSlug: course.slug,
    },
  });
}
