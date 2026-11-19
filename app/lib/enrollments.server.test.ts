import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { enrollUser } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
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
    const enrollment = enrollUser(db, base.user.id, base.course.id);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("refuses a user who is already enrolled, leaving one Enrollment", () => {
    enrollUser(db, base.user.id, base.course.id);

    expect(() => enrollUser(db, base.user.id, base.course.id)).toThrow(
      "User is already enrolled in this course"
    );
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("refuses a course that does not exist", () => {
    expect(() => enrollUser(db, base.user.id, 9999)).toThrow(
      "Course not found"
    );
    expect(enrollmentsOf(base.user.id)).toHaveLength(0);
  });
});
