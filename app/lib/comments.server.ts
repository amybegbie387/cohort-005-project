// ─── Discussion comments (server) ───
// The one place Discussion Questions and Discussion Replies are created,
// edited and soft-deleted. Both the lesson page and the instructor questions
// page call these.

import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import {
  archiveForCommentSafely,
  triggerSafely,
  type NotificationSender,
  type NotificationService,
  type NotificationUser,
} from "~/lib/notifications.server";

type Db = BetterSQLite3Database<typeof schema>;
type User = typeof schema.users.$inferSelect;

const { comments, courses, lessons, modules, users } = schema;

const SNIPPET_LENGTH = 120;

function assertValidBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

function getLessonContext(db: Db, lessonId: number) {
  return db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

export function getComment(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function toNotificationUser(user: User): NotificationUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

function toNotificationSender(user: User): NotificationSender {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
}

function toSnippet(body: string) {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_LENGTH
    ? `${oneLine.slice(0, SNIPPET_LENGTH).trimEnd()}…`
    : oneLine;
}

/**
 * Creates a Discussion Question (no parent) or a Discussion Reply, then
 * notifies whoever it concerns. Throws an Error for anything the user can fix.
 */
export function createComment(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  notifications: NotificationService
) {
  const trimmed = assertValidBody(body);

  const lesson = getLessonContext(db, lessonId);
  if (!lesson) {
    throw new Error("Lesson not found");
  }

  const parent = parentId === null ? null : getComment(db, parentId);
  if (parentId !== null) {
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  const comment = db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  // A Discussion Question concerns the Instructor; a Discussion Reply concerns
  // only the question's author. Nobody is told about their own comment.
  const recipientId = parent ? parent.userId : lesson.instructorId;
  if (recipientId === userId) return comment;

  const author = db.select().from(users).where(eq(users.id, userId)).get();
  const recipient = db
    .select()
    .from(users)
    .where(eq(users.id, recipientId))
    .get();

  if (author && recipient) {
    const isReply = parent !== null;
    const event = isReply
      ? "discussion-reply-posted"
      : "discussion-question-asked";
    triggerSafely(notifications, {
      event,
      category: isReply ? "discussion-replies" : "discussion-questions",
      recipient: toNotificationUser(recipient),
      idempotencyKey: `${event}:${comment.id}`,
      data: {
        sender: toNotificationSender(author),
        link: `/courses/${lesson.courseSlug}/lessons/${lesson.lessonId}#comment-${comment.id}`,
        commentId: comment.id,
        lessonId: lesson.lessonId,
        lessonTitle: lesson.lessonTitle,
        courseId: lesson.courseId,
        courseTitle: lesson.courseTitle,
        courseSlug: lesson.courseSlug,
        snippet: toSnippet(trimmed),
      },
    });
  }

  return comment;
}

export function updateComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string
) {
  const trimmed = assertValidBody(body);

  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.deletedAt !== null) {
    throw new Error("Comment has been deleted");
  }
  if (existing.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  return db
    .update(comments)
    .set({ body: trimmed, editedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

/**
 * Soft delete. Staff may delete anyone's comment; everyone else only their own.
 * Archives the Notifications this comment itself caused — never those of the
 * replies beneath it, which stay visible.
 */
export function deleteComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean,
  notifications: NotificationService
) {
  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return existing;
  }

  const deleted = db
    .update(comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  archiveForCommentSafely(notifications, commentId);

  return deleted;
}
