// ─── Seat claims (server) ───
// Claiming a Seat on a Team Licence with its coupon code, and telling the Team
// Admin who owns the Team Licence. The redeem page calls this.
//
// Takes the database first and the Notification service last, like the other
// services.

import { and, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { createEnrollment, isUserEnrolled } from "~/lib/enrollments.server";
import { getSeatAvailability } from "~/lib/refunds.server";
import {
  triggerSafely,
  type NotificationService,
} from "~/lib/notifications.server";

type Db = BetterSQLite3Database<typeof schema>;

const { coupons, courses, purchases, users } = schema;

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

/** The claim can't go ahead for a reason the claimer can read. */
export class SeatClaimError extends Error {}

function getSeatsRemaining(db: Db, purchaseId: number) {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, purchaseId),
        isNull(coupons.redeemedAt),
        isNull(coupons.refundedAt)
      )
    )
    .get();
  return result?.count ?? 0;
}

/**
 * Claims the Seat with this code for the user and enrolls them. Throws a
 * SeatClaimError for anything the claimer can fix.
 */
export function claimSeat(
  db: Db,
  code: string,
  userId: number,
  userCountry: string,
  notifications: NotificationService
) {
  const seat = db.select().from(coupons).where(eq(coupons.code, code)).get();
  if (!seat) {
    throw new SeatClaimError("Coupon not found");
  }

  if (seat.redeemedByUserId !== null) {
    throw new SeatClaimError("Coupon has already been redeemed");
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    throw new SeatClaimError(SEAT_ON_HOLD);
  }
  if (availability === "refunded") {
    throw new SeatClaimError(SEAT_REFUNDED);
  }

  if (isUserEnrolled(db, userId, seat.courseId)) {
    throw new SeatClaimError("You are already enrolled in this course");
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    throw new SeatClaimError(
      "This coupon can only be redeemed from the same country as the purchaser"
    );
  }

  const enrollment = db.transaction((tx) => {
    tx.update(coupons)
      .set({
        redeemedByUserId: userId,
        redeemedAt: new Date().toISOString(),
      })
      .where(eq(coupons.id, seat.id))
      .run();

    return createEnrollment(tx, userId, seat.courseId);
  });

  // The claim has committed. Nothing below may undo it.
  notifyTeamAdmin(db, seat, purchase?.userId ?? null, userId, notifications);

  return { enrollment };
}

function notifyTeamAdmin(
  db: Db,
  seat: typeof coupons.$inferSelect,
  teamAdminId: number | null,
  claimerId: number,
  notifications: NotificationService
) {
  // Nobody is told about their own claim.
  if (teamAdminId === null || teamAdminId === claimerId) return;

  const teamAdmin = db
    .select()
    .from(users)
    .where(eq(users.id, teamAdminId))
    .get();
  const claimer = db.select().from(users).where(eq(users.id, claimerId)).get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, seat.courseId))
    .get();
  if (!teamAdmin || !claimer || !course) return;

  triggerSafely(notifications, {
    event: "seat-claimed",
    category: "seat-claims",
    recipient: {
      id: teamAdmin.id,
      name: teamAdmin.name,
      email: teamAdmin.email,
      avatarUrl: teamAdmin.avatarUrl,
    },
    idempotencyKey: `seat-claimed:${seat.id}`,
    data: {
      sender: {
        id: claimer.id,
        name: claimer.name,
        avatarUrl: claimer.avatarUrl,
      },
      link: "/team",
      courseId: course.id,
      courseTitle: course.title,
      courseSlug: course.slug,
      seatsRemaining: getSeatsRemaining(db, seat.purchaseId),
    },
  });
}
