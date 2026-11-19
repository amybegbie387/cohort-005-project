import { data } from "react-router";
import type { Route } from "./+types/api.notification-token";
import { issueFeedToken } from "~/lib/notification-feed.server";
import { getNotificationEnv } from "~/lib/notifications-instance.server";
import { getCurrentUserId } from "~/lib/session";

/**
 * Signs a Feed token for the session user, so the browser can talk to the
 * vendor as that user and no one else. Asked again whenever the DevUI switcher
 * changes the user, and before a token expires.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const token = await issueFeedToken(getNotificationEnv(), userId);
  if (token === null) {
    throw data("The Notification Feed is not configured.", { status: 404 });
  }

  return data(
    { userId, token },
    { headers: { "Cache-Control": "no-store" } }
  );
}
