import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, TeamMemberRole, UserRole } from "~/db/schema";
import {
  claimSeat,
  SeatClaimError,
  SEAT_ON_HOLD,
  SEAT_REFUNDED,
} from "./seat-claims.server";
import {
  createFakeNotifications,
  type FakeNotifications,
  type NotificationService,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;
let teamAdmin: typeof schema.users.$inferSelect;
let purchase: typeof schema.purchases.$inferSelect;
let seats: (typeof schema.coupons.$inferSelect)[];

function addUser(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s/g, "")}@example.com`,
      avatarUrl: `https://example.com/${name.replace(/\s/g, "")}.png`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buyTeamLicence(
  buyerId: number,
  seatCount: number,
  country: string | null = null
) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId: buyerId, role: TeamMemberRole.Admin })
    .run();
  const bought = db
    .insert(schema.purchases)
    .values({
      userId: buyerId,
      courseId: base.course.id,
      amountPaid: 1000 * seatCount,
      country,
    })
    .returning()
    .get();
  const created = Array.from({ length: seatCount }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `seat-${bought.id}-${i}`,
        purchaseId: bought.id,
      })
      .returning()
      .get()
  );
  return { purchase: bought, seats: created };
}

function getSeat(id: number) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, id))
    .get()!;
}

function enrollmentsOf(userId: number) {
  return db
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, userId))
    .all();
}

function claim(code: string, userId: number, country = "") {
  return claimSeat(db, code, userId, country, notifications);
}

function claimError(code: string, userId: number, country = "") {
  try {
    claim(code, userId, country);
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(() => {
  notifications = createFakeNotifications();
  db = createTestDb();
  base = seedBaseData(db);
  teamAdmin = addUser("Tina Teamadmin");
  ({ purchase, seats } = buyTeamLicence(teamAdmin.id, 3));
});

describe("claiming a Seat", () => {
  it("enrolls the claimer and marks the Seat claimed", () => {
    const result = claim(seats[0].code, base.user.id);

    expect(result.enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
    expect(getSeat(seats[0].id)).toMatchObject({
      redeemedByUserId: base.user.id,
    });
    expect(getSeat(seats[0].id).redeemedAt).not.toBeNull();
  });

  it("throws a SeatClaimError when the Seat does not exist", () => {
    const error = claimError("nope", base.user.id);

    expect(error).toBeInstanceOf(SeatClaimError);
    expect((error as Error).message).toBe("Coupon not found");
    expect(notifications.triggers).toEqual([]);
  });

  it("refuses a Seat that is already claimed, leaving it with its first claimer", () => {
    const first = addUser("First Claimer");
    claim(seats[0].code, first.id);
    notifications.triggers.length = 0;

    const error = claimError(seats[0].code, base.user.id);

    expect((error as Error).message).toBe("Coupon has already been redeemed");
    expect(getSeat(seats[0].id).redeemedByUserId).toBe(first.id);
    expect(enrollmentsOf(base.user.id)).toHaveLength(0);
    expect(notifications.triggers).toEqual([]);
  });

  it("refuses a claimer who is already enrolled, leaving the Seat unclaimed", () => {
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    const error = claimError(seats[0].code, base.user.id);

    expect(error).toBeInstanceOf(SeatClaimError);
    expect((error as Error).message).toBe(
      "You are already enrolled in this course"
    );
    expect(getSeat(seats[0].id).redeemedAt).toBeNull();
    expect(notifications.triggers).toEqual([]);
  });

  it("refuses a Seat that is on hold while its Team Licence has an Open Refund Request", () => {
    db.insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        status: RefundStatus.Open,
        reason: "Changed my mind",
      })
      .run();

    const error = claimError(seats[0].code, base.user.id);

    expect((error as Error).message).toBe(SEAT_ON_HOLD);
    expect(getSeat(seats[0].id).redeemedAt).toBeNull();
    expect(notifications.triggers).toEqual([]);
  });

  it("refuses a Seat whose Team Licence was refunded", () => {
    db.update(schema.coupons)
      .set({ refundedAt: new Date().toISOString() })
      .where(eq(schema.coupons.id, seats[0].id))
      .run();

    const error = claimError(seats[0].code, base.user.id);

    expect((error as Error).message).toBe(SEAT_REFUNDED);
    expect(getSeat(seats[0].id).redeemedAt).toBeNull();
  });

  it("refuses a claimer from a different country than the purchaser", () => {
    ({ seats } = buyTeamLicence(addUser("Gina Gb").id, 1, "GB"));

    const error = claimError(seats[0].code, base.user.id, "US");

    expect((error as Error).message).toBe(
      "This coupon can only be redeemed from the same country as the purchaser"
    );
    expect(getSeat(seats[0].id).redeemedAt).toBeNull();
    expect(notifications.triggers).toEqual([]);
  });

  it("accepts a claimer from the purchaser's country", () => {
    ({ seats } = buyTeamLicence(addUser("Gina Gb").id, 1, "GB"));

    claim(seats[0].code, base.user.id, "GB");

    expect(getSeat(seats[0].id).redeemedByUserId).toBe(base.user.id);
  });
});

describe("notifying the Team Admin of a Seat claim", () => {
  function seatClaimTriggers() {
    return notifications.triggers.filter((t) => t.event === "seat-claimed");
  }

  it("tells the Team Admin who claimed it, which course and how many Seats are left", () => {
    claim(seats[0].code, base.user.id);

    expect(seatClaimTriggers()).toEqual([
      {
        event: "seat-claimed",
        category: "seat-claims",
        recipient: {
          id: teamAdmin.id,
          name: "Tina Teamadmin",
          email: "tinateamadmin@example.com",
          avatarUrl: "https://example.com/TinaTeamadmin.png",
        },
        idempotencyKey: `seat-claimed:${seats[0].id}`,
        data: {
          sender: { id: base.user.id, name: "Test User", avatarUrl: null },
          link: "/team",
          courseId: base.course.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          seatsRemaining: 2,
        },
      },
    ]);
  });

  it("counts Seats left on the same Team Licence only, and sends one per claim", () => {
    buyTeamLicence(teamAdmin.id, 5);
    const second = addUser("Sam Second");
    const third = addUser("Thea Third");

    claim(seats[0].code, base.user.id);
    claim(seats[1].code, second.id);
    claim(seats[2].code, third.id);

    expect(seatClaimTriggers().map((t) => t.data.seatsRemaining)).toEqual([
      2, 1, 0,
    ]);
    expect(seatClaimTriggers().map((t) => t.idempotencyKey)).toEqual([
      `seat-claimed:${seats[0].id}`,
      `seat-claimed:${seats[1].id}`,
      `seat-claimed:${seats[2].id}`,
    ]);
  });

  it("does not count refunded Seats as left", () => {
    db.update(schema.coupons)
      .set({ refundedAt: new Date().toISOString() })
      .where(eq(schema.coupons.id, seats[2].id))
      .run();

    claim(seats[0].code, base.user.id);

    expect(seatClaimTriggers()[0].data.seatsRemaining).toBe(1);
  });

  it("sends nothing extra when the last Seat is claimed", () => {
    ({ seats } = buyTeamLicence(teamAdmin.id, 1));

    claim(seats[0].code, base.user.id);

    expect(seatClaimTriggers()).toHaveLength(1);
    expect(seatClaimTriggers()[0].data.seatsRemaining).toBe(0);
  });

  it("notifies nobody when the Team Admin claims their own Seat", () => {
    claim(seats[0].code, teamAdmin.id);

    expect(getSeat(seats[0].id).redeemedByUserId).toBe(teamAdmin.id);
    expect(seatClaimTriggers()).toEqual([]);
  });

  it("still completes the claim when the trigger fails", () => {
    const failing: NotificationService = {
      ...notifications,
      trigger: () => Promise.reject(new Error("vendor down")),
    };

    claimSeat(db, seats[0].code, base.user.id, "", failing);

    expect(getSeat(seats[0].id).redeemedByUserId).toBe(base.user.id);
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("still completes the claim when the trigger throws synchronously", () => {
    const failing: NotificationService = {
      ...notifications,
      trigger: () => {
        throw new Error("vendor down");
      },
    };

    claimSeat(db, seats[0].code, base.user.id, "", failing);

    expect(getSeat(seats[0].id).redeemedByUserId).toBe(base.user.id);
  });
});

describe("notifying the Instructor of a claimed Seat's Enrollment", () => {
  function enrollmentTriggers() {
    return notifications.triggers.filter(
      (t) => t.event === "enrollment-created"
    );
  }

  it("tells the Instructor which Student enrolled", () => {
    const { enrollment } = claim(seats[0].code, base.user.id);

    expect(enrollmentTriggers()).toEqual([
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

  it("notifies when a Lapsed Student claims a Seat", () => {
    const module = db
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "M", position: 1 })
      .returning()
      .get();
    const lesson = db
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "L", position: 1 })
      .returning()
      .get();
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();

    claim(seats[0].code, base.user.id);

    expect(enrollmentTriggers()).toHaveLength(1);
  });

  it("notifies nobody when the Instructor claims a Seat on their own course", () => {
    claim(seats[0].code, base.instructor.id);

    expect(enrollmentTriggers()).toEqual([]);
  });

  it("still completes the claim when the Enrollment trigger fails", () => {
    const failing: NotificationService = {
      ...notifications,
      trigger: (n) =>
        n.event === "enrollment-created"
          ? Promise.reject(new Error("vendor down"))
          : notifications.trigger(n),
    };

    claimSeat(db, seats[0].code, base.user.id, "", failing);

    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
    expect(notifications.triggers.map((t) => t.event)).toEqual([
      "seat-claimed",
    ]);
  });
});
