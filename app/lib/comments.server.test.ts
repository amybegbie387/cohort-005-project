import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createComment, deleteComment, updateComment } from "./comments.server";
import { MAX_COMMENT_LENGTH } from "./comments";
import {
  createFakeNotifications,
  type FakeNotifications,
  type NotificationService,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;
let notifications: FakeNotifications;

function addUser(name: string, role: schema.UserRole = UserRole.Student) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\s/g, "")}@example.com`,
      avatarUrl: `https://example.com/${name.replace(/\s/g, "")}.png`,
      role,
    })
    .returning()
    .get();
}

function addLesson(moduleId: number, title: string) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position: 1 })
    .returning()
    .get();
}

beforeEach(() => {
  notifications = createFakeNotifications();
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = addLesson(module.id, "Intro to Cadence").id;
  otherLessonId = addLesson(module.id, "Second lesson").id;
});

function ask(authorId: number, body = "A question") {
  return createComment(db, authorId, lessonId, null, body, notifications);
}

function triggersOf(event: string) {
  return notifications.triggers.filter((t) => t.event === event);
}

describe("creating a Discussion Reply", () => {
  it("notifies the question's author only, linking to the reply", () => {
    const asker = addUser("Ann Asker");
    const bystander = addUser("Bea Bystander");
    const question = ask(asker.id, "How do I start?");
    // Someone else already replied in the thread; they are not told of more.
    createComment(
      db,
      bystander.id,
      lessonId,
      question.id,
      "Same",
      notifications
    );
    notifications.triggers.length = 0;

    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Read the first lesson",
      notifications
    );

    expect(notifications.triggers).toEqual([
      {
        event: "discussion-reply-posted",
        category: "discussion-replies",
        recipient: {
          id: asker.id,
          name: "Ann Asker",
          email: "annasker@example.com",
          avatarUrl: "https://example.com/AnnAsker.png",
        },
        idempotencyKey: `discussion-reply-posted:${reply.id}`,
        data: {
          sender: {
            id: base.instructor.id,
            name: "Test Instructor",
            avatarUrl: null,
          },
          link: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
          commentId: reply.id,
          lessonId,
          lessonTitle: "Intro to Cadence",
          courseId: base.course.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          snippet: "Read the first lesson",
        },
      },
    ]);
  });

  it("notifies nobody when the question's author replies to themselves", () => {
    const asker = addUser("Ann Asker");
    const question = ask(asker.id);
    notifications.triggers.length = 0;

    createComment(
      db,
      asker.id,
      lessonId,
      question.id,
      "Never mind",
      notifications
    );

    expect(notifications.triggers).toEqual([]);
  });

  it("does not tell the Instructor about their own reply to their own question", () => {
    const question = ask(base.instructor.id);

    createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Follow-up",
      notifications
    );

    expect(notifications.triggers).toEqual([]);
  });

  it("notifies the Instructor of a student's reply to the Instructor's own question", () => {
    const student = addUser("Sam Student");
    const question = ask(base.instructor.id);

    createComment(
      db,
      student.id,
      lessonId,
      question.id,
      "Answer",
      notifications
    );

    expect(triggersOf("discussion-reply-posted")).toHaveLength(1);
    expect(triggersOf("discussion-reply-posted")[0].recipient.id).toBe(
      base.instructor.id
    );
  });
});

describe("creating a Discussion Question", () => {
  it("notifies the Instructor when a Platform Admin asks", () => {
    const platformAdmin = addUser("Pat Admin", UserRole.Admin);

    ask(platformAdmin.id);

    expect(triggersOf("discussion-question-asked")).toHaveLength(1);
    expect(notifications.triggers[0].recipient.id).toBe(base.instructor.id);
  });

  it("does not notify the Instructor of their own question", () => {
    ask(base.instructor.id);

    expect(notifications.triggers).toEqual([]);
  });

  it("stores the trimmed body and notifies the Instructor", () => {
    const student = addUser("Sam Student");

    const comment = createComment(
      db,
      student.id,
      lessonId,
      null,
      "  How do I start?  ",
      notifications
    );

    expect(comment).toMatchObject({
      userId: student.id,
      lessonId,
      parentId: null,
      body: "How do I start?",
    });
    expect(notifications.triggers).toEqual([
      {
        event: "discussion-question-asked",
        category: "discussion-questions",
        recipient: {
          id: base.instructor.id,
          name: "Test Instructor",
          email: "instructor@example.com",
          avatarUrl: null,
        },
        idempotencyKey: `discussion-question-asked:${comment.id}`,
        data: {
          sender: {
            id: student.id,
            name: "Sam Student",
            avatarUrl: "https://example.com/SamStudent.png",
          },
          link: `/courses/test-course/lessons/${lessonId}#comment-${comment.id}`,
          commentId: comment.id,
          lessonId,
          lessonTitle: "Intro to Cadence",
          courseId: base.course.id,
          courseTitle: "Test Course",
          courseSlug: "test-course",
          snippet: "How do I start?",
        },
      },
    ]);
  });

  it("puts a one-line, truncated snippet in the trigger data", () => {
    const student = addUser("Sam Student");

    ask(student.id, `First line\n\nsecond   line ${"x".repeat(300)}`);

    const snippet = notifications.triggers[0].data.snippet;
    expect(typeof snippet).toBe("string");
    expect((snippet as string).startsWith("First line second line xxx")).toBe(
      true
    );
    expect((snippet as string).endsWith("…")).toBe(true);
    expect((snippet as string).length).toBeLessThanOrEqual(121);
  });

  it("still creates the comment when the notification service fails", () => {
    const student = addUser("Sam Student");
    const failing: NotificationService = {
      ...notifications,
      trigger: () => Promise.reject(new Error("vendor down")),
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const comment = createComment(
      db,
      student.id,
      lessonId,
      null,
      "Hi",
      failing
    );

    expect(
      db
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.id, comment.id))
        .get()
    ).toBeDefined();
    logged.mockRestore();
  });
});

describe("comment validation", () => {
  it("rejects an empty or whitespace-only body", () => {
    const student = addUser("Sam Student");
    expect(() => ask(student.id, "   ")).toThrow("Comment cannot be empty");
  });

  it("rejects a body over the length limit", () => {
    const student = addUser("Sam Student");
    expect(() => ask(student.id, "x".repeat(MAX_COMMENT_LENGTH + 1))).toThrow(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  });

  it("rejects a lesson that does not exist", () => {
    const student = addUser("Sam Student");
    expect(() =>
      createComment(db, student.id, 9999, null, "Hi", notifications)
    ).toThrow("Lesson not found");
  });

  it("rejects a parent that does not exist", () => {
    const student = addUser("Sam Student");
    expect(() =>
      createComment(db, student.id, lessonId, 9999, "Hi", notifications)
    ).toThrow("Parent comment not found");
  });

  it("rejects a parent from a different lesson", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);
    expect(() =>
      createComment(
        db,
        student.id,
        otherLessonId,
        question.id,
        "Hi",
        notifications
      )
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("rejects a reply to a reply", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "A",
      notifications
    );
    expect(() =>
      createComment(db, student.id, lessonId, reply.id, "B", notifications)
    ).toThrow("Replies can only be one level deep");
  });

  it("notifies nobody when validation fails", () => {
    const student = addUser("Sam Student");
    expect(() => ask(student.id, "")).toThrow();
    expect(notifications.triggers).toEqual([]);
  });
});

describe("editing a comment", () => {
  it("updates the body and marks it edited, without notifying", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);
    notifications.triggers.length = 0;

    const edited = updateComment(db, question.id, student.id, " Better ");

    expect(edited.body).toBe("Better");
    expect(edited.editedAt).not.toBeNull();
    expect(notifications.triggers).toEqual([]);
  });

  it("rejects editing someone else's comment", () => {
    const student = addUser("Sam Student");
    const other = addUser("Olly Other");
    const question = ask(student.id);
    expect(() => updateComment(db, question.id, other.id, "Hijack")).toThrow(
      "You can only edit your own comments"
    );
  });

  it("rejects an invalid body, a missing comment and a deleted comment", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);
    expect(() => updateComment(db, question.id, student.id, " ")).toThrow(
      "Comment cannot be empty"
    );
    expect(() => updateComment(db, 9999, student.id, "Hi")).toThrow(
      "Comment not found"
    );
    deleteComment(db, question.id, student.id, false, notifications);
    expect(() => updateComment(db, question.id, student.id, "Hi")).toThrow(
      "Comment has been deleted"
    );
  });
});

describe("deleting a comment", () => {
  it("soft-deletes the author's own comment", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);

    const deleted = deleteComment(db, question.id, student.id, false, notifications);

    expect(deleted.deletedAt).not.toBeNull();
    expect(
      db
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.id, question.id))
        .get()
    ).toBeDefined();
  });

  it("lets staff delete someone else's comment", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);

    expect(
      deleteComment(db, question.id, base.instructor.id, true, notifications).deletedAt
    ).not.toBeNull();
  });

  it("rejects a non-staff user deleting someone else's comment", () => {
    const student = addUser("Sam Student");
    const other = addUser("Olly Other");
    const question = ask(student.id);

    expect(() => deleteComment(db, question.id, other.id, false, notifications)).toThrow(
      "You can only delete your own comments"
    );
  });

  it("rejects a comment that does not exist", () => {
    expect(() => deleteComment(db, 9999, base.user.id, true, notifications)).toThrow(
      "Comment not found"
    );
  });

  it("archives the Notifications the deleted comment caused", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);

    deleteComment(db, question.id, student.id, false, notifications);

    expect(notifications.archivedCommentIds).toEqual([question.id]);
  });

  it("archives a deleted reply's Notification by the reply's own id", () => {
    const asker = addUser("Ann Asker");
    const replier = addUser("Ray Replier");
    const question = ask(asker.id);
    const reply = createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "Try this",
      notifications
    );

    deleteComment(db, reply.id, replier.id, false, notifications);

    expect(notifications.archivedCommentIds).toEqual([reply.id]);
  });

  it("leaves Discussion Reply Notifications in place when their question is deleted", () => {
    const asker = addUser("Ann Asker");
    const replier = addUser("Ray Replier");
    const question = ask(asker.id);
    const reply = createComment(
      db,
      replier.id,
      lessonId,
      question.id,
      "Try this",
      notifications
    );

    deleteComment(db, question.id, asker.id, false, notifications);

    expect(notifications.archivedCommentIds).toEqual([question.id]);
    expect(notifications.archivedCommentIds).not.toContain(reply.id);
  });

  it("archives nothing when the delete is rejected", () => {
    const student = addUser("Sam Student");
    const other = addUser("Olly Other");
    const question = ask(student.id);

    expect(() =>
      deleteComment(db, question.id, other.id, false, notifications)
    ).toThrow();

    expect(notifications.archivedCommentIds).toEqual([]);
  });

  it("changes no sent Notification when a comment is edited", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);
    const triggersBefore = [...notifications.triggers];

    updateComment(db, question.id, student.id, "Reworded question");

    expect(notifications.archivedCommentIds).toEqual([]);
    expect(notifications.triggers).toEqual(triggersBefore);
  });

  it("still deletes when archiving rejects, and logs the failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const student = addUser("Sam Student");
    const question = ask(student.id);
    const failing: NotificationService = {
      ...notifications,
      archiveForComment: () => Promise.reject(new Error("vendor down")),
    };

    const deleted = deleteComment(db, question.id, student.id, false, failing);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deleted.deletedAt).not.toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("still deletes when archiving throws synchronously, and logs the failure", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const student = addUser("Sam Student");
    const question = ask(student.id);
    const failing: NotificationService = {
      ...notifications,
      archiveForComment: () => {
        throw new Error("vendor down");
      },
    };

    const deleted = deleteComment(db, question.id, student.id, false, failing);

    expect(deleted.deletedAt).not.toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("leaves an already deleted comment's timestamp alone", () => {
    const student = addUser("Sam Student");
    const question = ask(student.id);
    const first = deleteComment(db, question.id, student.id, false, notifications);

    const second = deleteComment(db, question.id, student.id, false, notifications);

    expect(second.deletedAt).toBe(first.deletedAt);
  });
});
