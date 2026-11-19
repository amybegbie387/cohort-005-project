// ─── Enrollments (server) ───
// Creating an Enrollment. Every Enrollment row is written by `createEnrollment`;
// `enrollUser` (Individual Purchase) and `claimSeat` (seat-claims.server.ts)
// are the two paths that reach it, and where anything that follows a new
// Enrollment belongs.

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const { courses, enrollments } = schema;

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
 * Enrolls a user in a course (Individual Purchase). Throws an Error for
 * anything the user can fix.
 */
export function enrollUser(db: Db, userId: number, courseId: number) {
  if (isUserEnrolled(db, userId, courseId)) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) {
    throw new Error("Course not found");
  }

  return createEnrollment(db, userId, courseId);
}
