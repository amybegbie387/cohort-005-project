import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notification-preferences";
import { NOTIFICATION_CATEGORIES } from "~/lib/notification-preferences";
import { saveNotificationSwitch } from "~/lib/notification-preferences.server";
import { getNotifications } from "~/lib/notifications-instance.server";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";

const switchSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/**
 * Saves one switch on /settings. Merges into the person's preferences; never
 * replaces them. A failed save is returned, not thrown, so the switch's own
 * fetcher can toast and revert instead of the page showing its error screen.
 */
export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const parsed = parseFormData(await request.formData(), switchSchema);
  if (!parsed.success) {
    throw data("Invalid notification preference.", { status: 400 });
  }

  try {
    await saveNotificationSwitch(
      getNotifications(),
      userId,
      parsed.data.category,
      parsed.data.enabled
    );
  } catch (error) {
    console.error(`[notifications] save preference for user ${userId} failed`, error);
    return { saved: false as const };
  }
  return { saved: true as const };
}
