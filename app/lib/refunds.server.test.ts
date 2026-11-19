import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { LessonProgressStatus, RefundStatus, UserRole } from "~/db/schema";
import {
  approveRefundRequest as approveWithNotifications,
  checkRefundRequest,
  declineRefundRequest as declineWithNotifications,
  getRefundOffer,
  getSeatAvailability,
  listRefundRequestsForBuyer,
  listRefundRequestsForReview,
  listTeamLicences,
  raiseRefundRequest as raiseWithNotifications,
} from "./refunds.server";
import {
  createFakeNotifications,
  type FakeNotifications,
  type NotificationService,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

// Tests that are not about Notifications leave the fake out; the ones that are
// pass it explicitly.
const raiseRefundRequest = (
  db: TestDb,
  purchaseId: number,
  buyerId: number,
  reason: string,
  now: Date,
  service: NotificationService = notifications
) => raiseWithNotifications(db, purchaseId, buyerId, reason, now, service);

const approveRefundRequest = (
  db: TestDb,
  refundRequestId: number,
  platformAdminId: number,
  note: string | null,
  now: Date,
  service: NotificationService = notifications
) =>
  approveWithNotifications(
    db,
    refundRequestId,
    platformAdminId,
    note,
    now,
    service
  );

const declineRefundRequest = (
  db: TestDb,
  refundRequestId: number,
  platformAdminId: number,
  note: string,
  now: Date,
  service: NotificationService = notifications
) =>
  declineWithNotifications(
    db,
    refundRequestId,
    platformAdminId,
    note,
    now,
    service
  );

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(days: number) {
  const when = new Date(NOW);
  when.setDate(when.getDate() - days);
  return when.toISOString();
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;
let lessonIds: number[];
let notifications: FakeNotifications;

beforeEach(() => {
  notifications = createFakeNotifications();
  db = createTestDb();
  base = seedBaseData(db);

  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addLearner(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function buyForSelf(userId: number, daysAgo = 3, amountPaid = 7900) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function buySeats(userId: number, seats: number, daysAgo = 3) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      createdAt: daysBefore(daysAgo),
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function claimSeat(seatId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: daysBefore(1) })
    .where(eq(schema.coupons.id, seatId))
    .run();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function isEnrolled(userId: number) {
  return !!db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .get();
}

function raise(purchaseId: number, buyerId: number) {
  const result = raiseRefundRequest(
    db,
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW,
    notifications
  );
  if (!result.ok) throw new Error(result.error);
  return result.refundRequestId;
}

function getSeat(seatId: number) {
  const seat = db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, seatId))
    .get();
  if (!seat) throw new Error("Seat not found");
  return seat;
}

describe("raising a Refund Request", () => {
  it("lets the buyer raise one on an Individual Purchase inside the window", () => {
    const purchase = buyForSelf(base.user.id);

    const result = raiseRefundRequest(db, purchase.id, base.user.id, "Nope.", NOW);

    expect(result).toMatchObject({ ok: true, kind: "individual_purchase" });
  });

  it("refuses anyone but the buyer", () => {
    const purchase = buyForSelf(base.user.id);
    const someoneElse = addLearner("Ben");

    expect(checkRefundRequest(db, purchase.id, someoneElse.id, NOW)).toMatchObject(
      { ok: false, status: 404 }
    );
  });

  it("allows only one Open Refund Request per Purchase", () => {
    const purchase = buyForSelf(base.user.id);
    raise(purchase.id, base.user.id);

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 409 }
    );
  });

  it("keeps the fourteenth day open and closes the fifteenth", () => {
    const onDay14 = buyForSelf(base.user.id, 14);
    const onDay15 = buyForSelf(addLearner("Ben").id, 15);

    expect(checkRefundRequest(db, onDay14.id, onDay14.userId, NOW).ok).toBe(true);
    expect(
      checkRefundRequest(db, onDay15.id, onDay15.userId, NOW)
    ).toMatchObject({ ok: false, error: "The 14-day window has closed." });
  });

  it("refuses a buyer who has completed half the lessons", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.lessonProgress)
      .values(
        lessonIds.slice(0, 2).map((lessonId) => ({
          userId: base.user.id,
          lessonId,
          status: LessonProgressStatus.Completed,
        }))
      )
      .run();

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 403 }
    );
  });

  it("refuses a buyer who has watched two hours", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.videoWatchEvents)
      .values([
        { userId: base.user.id, lessonId: lessonIds[0], eventType: "progress", positionSeconds: 3600 },
        { userId: base.user.id, lessonId: lessonIds[1], eventType: "progress", positionSeconds: 3600 },
      ])
      .run();

    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW)).toMatchObject(
      { ok: false, status: 403 }
    );
  });

  it("refuses a Team Licence with a Claimed Seat", () => {
    const teamAdmin = addLearner("Priya");
    const { purchase, seats } = buySeats(teamAdmin.id, 3);
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(checkRefundRequest(db, purchase.id, teamAdmin.id, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("the refund offer on the course page", () => {
  it("offers the newest Individual Purchase, not a newer Team Licence", () => {
    const individual = buyForSelf(base.user.id, 3);
    buySeats(base.user.id, 5, 1);

    expect(getRefundOffer(db, base.user.id, base.course.id, NOW)).toMatchObject({
      purchaseId: individual.id,
      amount: 7900,
    });
  });

  it("offers nothing once the purchase has been refunded", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(getRefundOffer(db, base.user.id, base.course.id, NOW)).toBeNull();
  });
});

describe("approving a Refund Request", () => {
  it("removes the buyer's place on the course but keeps their progress", () => {
    const purchase = buyForSelf(base.user.id);
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        status: LessonProgressStatus.Completed,
      })
      .run();
    const id = raise(purchase.id, base.user.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(result.ok).toBe(true);
    expect(isEnrolled(base.user.id)).toBe(false);
    expect(
      db
        .select()
        .from(schema.lessonProgress)
        .where(eq(schema.lessonProgress.userId, base.user.id))
        .all()
    ).toHaveLength(1);

    const refundRequest = db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id))
      .get();
    expect(refundRequest).toMatchObject({
      status: RefundStatus.Approved,
      amountRefunded: 7900,
      resolvedByUserId: platformAdmin.id,
    });
  });

  it("keeps the buyer's place if they also hold a Claimed Seat for the course", () => {
    const priya = addLearner("Priya");
    const { seats } = buySeats(priya.id, 2);
    // Liam claims a Seat first, so his place on the course came from it.
    claimSeat(seats[0].id, base.user.id);
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: daysBefore(2),
      })
      .returning()
      .get();
    const id = raise(purchase.id, base.user.id);

    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(isEnrolled(base.user.id)).toBe(true);
  });

  it("makes a Team Licence's Unclaimed Seats unclaimable", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(result.ok).toBe(true);
    for (const seat of seats) {
      expect(getSeatAvailability(db, getSeat(seat.id))).toBe("refunded");
    }
  });

  it("refuses a Team Licence whose Seat was claimed after the request", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);
    // Seats are on hold while Open, but older data can still hold a claim.
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(approveRefundRequest(db, id, platformAdmin.id, null, NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(getSeatAvailability(db, getSeat(seats[1].id))).toBe("on_hold");
  });

  it("lets the first decision win", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    expect(
      declineRefundRequest(db, id, platformAdmin.id, "Too late.", NOW)
    ).toMatchObject({
      ok: false,
      status: 409,
      error: "This refund request was already approved.",
    });
  });

  it("emails the buyer that the refund is on its way", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    const result = approveRefundRequest(db, id, platformAdmin.id, null, NOW);

    if (!result.ok) throw new Error(result.error);
    expect(result.email.to).toBe("test@example.com");
    expect(result.email.subject).toBe("Refund approved — Test Course");
    expect(result.email.body).toContain("$79.00");
  });
});

describe("declining a Refund Request", () => {
  it("needs a note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    expect(declineRefundRequest(db, id, platformAdmin.id, "  ", NOW)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("keeps the buyer's place and lets them raise a new Refund Request", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);

    const result = declineRefundRequest(
      db,
      id,
      platformAdmin.id,
      "You finished the course.",
      NOW
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.email.body).toContain("You finished the course.");
    expect(isEnrolled(base.user.id)).toBe(true);
    expect(checkRefundRequest(db, purchase.id, base.user.id, NOW).ok).toBe(true);
  });

  it("frees a Team Licence's Seats again", () => {
    const priya = addLearner("Priya");
    const { purchase, seats } = buySeats(priya.id, 1);
    const id = raise(purchase.id, priya.id);
    expect(getSeatAvailability(db, getSeat(seats[0].id))).toBe("on_hold");

    declineRefundRequest(db, id, platformAdmin.id, "Seats are in use.", NOW);

    expect(getSeatAvailability(db, getSeat(seats[0].id))).toBe("available");
  });
});

describe("listing Refund Requests", () => {
  it("shows a Platform Admin live figures and the rules a request breaks", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    // Since raising the request, the buyer has finished half the course.
    db.insert(schema.lessonProgress)
      .values(
        lessonIds.slice(0, 2).map((lessonId) => ({
          userId: base.user.id,
          lessonId,
          status: LessonProgressStatus.Completed,
        }))
      )
      .run();

    const [row] = listRefundRequestsForReview(db, RefundStatus.Open, NOW);

    expect(row).toMatchObject({
      id,
      buyerName: "Test User",
      daysSincePurchase: 3,
      figures: {
        kind: "individual_purchase",
        lessonsCompleted: 2,
        lessonCount: 4,
      },
      ruleBreaks: ["completed_too_much"],
      canApprove: true,
    });
  });

  it("shows a Team Licence's Seats instead of the buyer's progress", () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 3);
    raise(purchase.id, priya.id);

    const [row] = listRefundRequestsForReview(db, RefundStatus.Open, NOW);

    expect(row.figures).toEqual({
      kind: "team_licence",
      seatCount: 3,
      claimedSeatCount: 0,
    });
  });

  it("lists only the requested status, oldest first", () => {
    const first = buyForSelf(base.user.id);
    const ben = addLearner("Ben");
    const second = buyForSelf(ben.id);
    const firstId = raise(first.id, base.user.id);
    const secondId = raiseRefundRequest(
      db,
      second.id,
      ben.id,
      "Changed my mind.",
      new Date(NOW.getTime() + 60_000)
    );
    if (!secondId.ok) throw new Error(secondId.error);

    expect(
      listRefundRequestsForReview(db, RefundStatus.Open, NOW).map((r) => r.id)
    ).toEqual([firstId, secondId.refundRequestId]);

    approveRefundRequest(db, firstId, platformAdmin.id, null, NOW);

    expect(
      listRefundRequestsForReview(db, RefundStatus.Approved, NOW)
    ).toMatchObject([{ id: firstId, decidedByName: "Pat Admin" }]);
  });

  it("shows a buyer their decided requests with the decline note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    declineRefundRequest(db, id, platformAdmin.id, "Past half way.", NOW);

    expect(listRefundRequestsForBuyer(db, base.user.id)).toMatchObject([
      { id, status: RefundStatus.Declined, decisionNote: "Past half way." },
    ]);
  });

  it("lists a Team Admin's Team Licences and whether each can be refunded", () => {
    const priya = addLearner("Priya");
    buySeats(priya.id, 2);
    const { seats } = buySeats(priya.id, 2);
    claimSeat(seats[0].id, addLearner("Ben").id);

    expect(listTeamLicences(db, priya.id, NOW)).toMatchObject([
      { seatCount: 2, claimedSeatCount: 1, canRequestRefund: false },
      { seatCount: 2, claimedSeatCount: 0, canRequestRefund: true },
    ]);
  });
});

describe("Refund Request Notifications", () => {
  it("confirms a raised Refund Request to the buyer, from Cadence, with no link", () => {
    const purchase = buyForSelf(base.user.id);

    const id = raise(purchase.id, base.user.id);

    expect(
      notifications.triggers.filter((t) => t.event === "refund-confirmed")
    ).toEqual([
      {
        event: "refund-confirmed",
        category: "refund-request-updates",
        recipient: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `refund-confirmed:${id}`,
        data: {
          sender: null,
          link: null,
          refundRequestId: id,
          purchaseId: purchase.id,
          courseId: base.course.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          amount: 7900,
          reason: "It was not what I expected.",
          decisionNote: null,
        },
      },
    ]);
  });

  it("notifies every Platform Admin of an Open Refund Request, from the buyer, linking to the refunds page", () => {
    const secondAdmin = db
      .insert(schema.users)
      .values({ name: "Sam Admin", email: "sam@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = buyForSelf(base.user.id);

    const id = raise(purchase.id, base.user.id);

    const opened = notifications.triggers.filter(
      (t) => t.event === "refund-opened"
    );
    expect(opened.map((t) => t.recipient.id).sort()).toEqual(
      [platformAdmin.id, secondAdmin.id].sort()
    );
    expect(opened[0]).toMatchObject({
      category: "open-refund-requests",
      idempotencyKey: `refund-opened:${id}`,
      data: {
        sender: { id: base.user.id, name: "Test User", avatarUrl: null },
        link: "/admin/refunds",
        refundRequestId: id,
        courseTitle: "Test Course",
        amount: 7900,
        reason: "It was not what I expected.",
      },
    });
  });

  it("only notifies admins who exist when the request is raised", () => {
    const purchase = buyForSelf(base.user.id);
    raise(purchase.id, base.user.id);
    const promoted = addLearner("Ben");
    db.update(schema.users)
      .set({ role: UserRole.Admin })
      .where(eq(schema.users.id, promoted.id))
      .run();

    expect(
      notifications.triggers.filter((t) => t.recipient.id === promoted.id)
    ).toEqual([]);
  });

  it("does not notify a Platform Admin of their own request", () => {
    const purchase = buyForSelf(platformAdmin.id);

    raise(purchase.id, platformAdmin.id);

    expect(
      notifications.triggers.filter((t) => t.event === "refund-opened")
    ).toEqual([]);
    expect(
      notifications.triggers.filter((t) => t.event === "refund-confirmed")
    ).toHaveLength(1);
  });

  it("tells the buyer their Refund Request was approved, with the course, amount and note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    notifications.triggers.length = 0;

    approveRefundRequest(db, id, platformAdmin.id, "Sorry it missed.", NOW, notifications);

    expect(notifications.triggers).toEqual([
      {
        event: "refund-approved",
        category: "refund-request-updates",
        recipient: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `refund-approved:${id}`,
        data: {
          sender: { id: platformAdmin.id, name: "Pat Admin", avatarUrl: null },
          link: "/settings",
          refundRequestId: id,
          purchaseId: purchase.id,
          courseId: base.course.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          amount: 7900,
          reason: null,
          decisionNote: "Sorry it missed.",
        },
      },
    ]);
  });

  it("tells the buyer their Refund Request was declined, with the note", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    notifications.triggers.length = 0;

    declineRefundRequest(db, id, platformAdmin.id, "Past half way.", NOW, notifications);

    expect(notifications.triggers).toMatchObject([
      {
        event: "refund-declined",
        category: "refund-request-updates",
        recipient: { id: base.user.id },
        idempotencyKey: `refund-declined:${id}`,
        data: {
          sender: { id: platformAdmin.id },
          link: "/settings",
          courseTitle: "Test Course",
          amount: 7900,
          decisionNote: "Past half way.",
        },
      },
    ]);
  });

  it("notifies a Team Admin of a decision on their Team Licence and links to the team page", () => {
    const priya = addLearner("Priya");
    const { purchase } = buySeats(priya.id, 2);
    const id = raise(purchase.id, priya.id);
    notifications.triggers.length = 0;

    approveRefundRequest(db, id, platformAdmin.id, null, NOW, notifications);

    expect(notifications.triggers).toMatchObject([
      {
        event: "refund-approved",
        recipient: { id: priya.id },
        data: { link: "/team", amount: 15800, decisionNote: null },
      },
    ]);
  });

  it("sends nothing when a decision is refused", () => {
    const purchase = buyForSelf(base.user.id);
    const id = raise(purchase.id, base.user.id);
    approveRefundRequest(db, id, platformAdmin.id, null, NOW, notifications);
    notifications.triggers.length = 0;

    declineRefundRequest(db, id, platformAdmin.id, "Too late.", NOW, notifications);
    declineRefundRequest(db, id, platformAdmin.id, "  ", NOW, notifications);

    expect(notifications.triggers).toEqual([]);
  });

  it("does not notify a Platform Admin of deciding their own request, nor remove other admins' Notifications", () => {
    const purchase = buyForSelf(platformAdmin.id);
    const id = raise(purchase.id, platformAdmin.id);
    notifications.triggers.length = 0;

    approveRefundRequest(db, id, platformAdmin.id, null, NOW, notifications);

    expect(notifications.triggers).toEqual([]);
    expect(notifications.archivedCommentIds).toEqual([]);
  });

  it("never fails a Refund Request action when a Notification cannot be sent", async () => {
    const failing = {
      ...notifications,
      trigger: () => Promise.reject(new Error("vendor down")),
    };
    const throwing = {
      ...notifications,
      trigger: (): Promise<void> => {
        throw new Error("vendor down");
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const [i, broken] of [failing, throwing].entries()) {
      const buyer = addLearner(`Buyer${i}`);
      const purchase = buyForSelf(buyer.id);
      const result = raiseRefundRequest(db, purchase.id, buyer.id, "Nope, thanks.", NOW, broken);
      if (!result.ok) throw new Error(result.error);
      expect(
        approveRefundRequest(db, result.refundRequestId, platformAdmin.id, null, NOW, broken)
      ).toMatchObject({ ok: true });
      expect(isEnrolled(buyer.id)).toBe(false);
    }
    await Promise.resolve();

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
