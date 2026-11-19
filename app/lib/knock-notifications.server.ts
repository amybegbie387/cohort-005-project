import Knock from "@knocklabs/node";
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPreferences,
  NotificationService,
  NotificationUser,
} from "~/lib/notifications.server";

// ─── Knock adapter ───
// The only code that knows Knock exists. It maps Cadence's names to Knock's:
//
// - an event is the key of a Knock workflow, which must exist in the Knock
//   dashboard with an in-app feed step. Its category must match the category
//   Cadence triggers it with; Knock reads it from the workflow, not the call.
// - a category is a Knock preference category under the same key.
// - the `feed` channel is Knock's `in_app_feed` channel type.
//
// Not covered by tests: it is checked by hand against the Development
// environment. Nothing else in Cadence imports @knocklabs/node.

const DEFAULT_PREFERENCE_SET = "default";

const CHANNEL_TYPES = {
  feed: "in_app_feed",
} as const satisfies Record<NotificationChannel, string>;

type KnockClient = Pick<Knock, "workflows" | "users" | "messages">;
type KnockPreferenceSet = Awaited<ReturnType<Knock["users"]["getPreferences"]>>;
type KnockCategories = NonNullable<KnockPreferenceSet["categories"]>;

function toKnockRecipient(user: NotificationUser) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl,
  };
}

function isNotFound(error: unknown) {
  return error instanceof Knock.NotFoundError;
}

function readFeedSetting(
  categories: KnockCategories,
  category: NotificationCategory
): boolean | undefined {
  const setting = categories[category];
  if (typeof setting === "boolean") return setting;
  const channelType = setting?.channel_types?.[CHANNEL_TYPES.feed];
  return typeof channelType === "boolean" ? channelType : undefined;
}

export function createKnockNotifications(
  secretApiKey: string,
  client: KnockClient = new Knock({ apiKey: secretApiKey })
): NotificationService {
  async function fetchPreferenceSet(userId: number) {
    try {
      return await client.users.getPreferences(
        String(userId),
        DEFAULT_PREFERENCE_SET
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  return {
    async trigger({ event, recipient, idempotencyKey, data }) {
      await client.workflows.trigger(
        event,
        {
          recipients: [toKnockRecipient(recipient)],
          actor: data.sender
            ? {
                id: String(data.sender.id),
                name: data.sender.name,
                avatar: data.sender.avatarUrl,
              }
            : null,
          data,
        },
        // Knock takes one key per request, and each recipient has a request.
        { idempotencyKey: `${idempotencyKey}:${recipient.id}` }
      );
    },

    async getPreferences(userId) {
      const set = await fetchPreferenceSet(userId);
      if (!set) return null;

      const preferences: NotificationPreferences = {};
      for (const category of Object.keys(
        set.categories ?? {}
      ) as NotificationCategory[]) {
        const feed = readFeedSetting(set.categories ?? {}, category);
        if (feed !== undefined) preferences[category] = { feed };
      }
      return preferences;
    },

    async mergePreferences(userId, changes) {
      // Knock replaces the whole set it is given, so start from what is there
      // and change only the categories asked for.
      const existing = await fetchPreferenceSet(userId);
      const categories: KnockCategories = { ...existing?.categories };

      for (const category of Object.keys(changes) as NotificationCategory[]) {
        const feed = changes[category]?.feed;
        if (feed === undefined) continue;

        const current = categories[category];
        const currentSetting = typeof current === "object" ? current : {};
        categories[category] = {
          ...currentSetting,
          channel_types: {
            ...currentSetting.channel_types,
            [CHANNEL_TYPES.feed]: feed,
          },
        };
      }

      await client.users.setPreferences(
        String(userId),
        DEFAULT_PREFERENCE_SET,
        {
          categories,
          channel_types: existing?.channel_types,
          channels: existing?.channels,
          workflows: existing?.workflows,
        }
      );
    },

    async syncUser(user) {
      const { id, ...properties } = toKnockRecipient(user);
      await client.users.update(id, properties);
    },

    async archiveForComment(commentId) {
      // Triggers put the comment id in their data as `commentId`.
      const messages = client.messages.list({
        trigger_data: JSON.stringify({ commentId }),
      });
      for await (const message of messages) {
        await client.messages.archive(message.id);
      }
    },
  };
}
