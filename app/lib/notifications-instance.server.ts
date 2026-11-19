import { createKnockNotifications } from "~/lib/knock-notifications.server";
import {
  createLoggingNotifications,
  type NotificationService,
} from "~/lib/notifications.server";

/** Knock when a secret key is set, otherwise a logging no-op. */
export function createNotificationsFromEnv(
  env: Record<string, string | undefined>
): NotificationService {
  const secretApiKey = env.KNOCK_SECRET_API_KEY;
  return secretApiKey
    ? createKnockNotifications(secretApiKey)
    : createLoggingNotifications();
}

let instance: NotificationService | undefined;

/** The app's one NotificationService. Routes pass it into services. */
export function getNotifications(): NotificationService {
  if (!instance) {
    // Vite does not copy .env values without a VITE_ prefix onto process.env.
    try {
      process.loadEnvFile(".env");
    } catch {
      // No .env file: use the real environment as it is.
    }
    instance = createNotificationsFromEnv(process.env);
  }
  return instance;
}
