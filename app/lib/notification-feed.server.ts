import { signUserToken } from "@knocklabs/node";

// ─── Notification Feed (server side of the browser connection) ───
// The browser talks to the vendor directly. It gets only what is safe to
// expose: the public API key and the feed channel id in loader data, and a
// short-lived token signed here for the session user. The signing key and the
// secret API key never leave the server.

import type { FeedConfig } from "~/lib/notification-feed-client";

type Env = Record<string, string | undefined>;

const TOKEN_LIFETIME_SECONDS = 60 * 60;

/** `null` unless the Feed can really connect: then it shows its empty state. */
export function getFeedConfig(env: Env): FeedConfig | null {
  const publicApiKey = env.KNOCK_PUBLIC_API_KEY;
  const feedChannelId = env.KNOCK_FEED_CHANNEL_ID;
  if (!publicApiKey || !feedChannelId || !env.KNOCK_SIGNING_KEY) return null;
  return { publicApiKey, feedChannelId };
}

/** A token that lets the browser read and change this one user's Feed. */
export async function issueFeedToken(
  env: Env,
  userId: number
): Promise<string | null> {
  const signingKey = env.KNOCK_SIGNING_KEY;
  if (!signingKey) return null;
  return signUserToken(String(userId), {
    signingKey,
    expiresInSeconds: TOKEN_LIFETIME_SECONDS,
  });
}
