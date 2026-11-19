import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect } from "vitest";
import { getFeedConfig, issueFeedToken } from "./notification-feed.server";

const signingKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const configured = {
  KNOCK_PUBLIC_API_KEY: "pk_test_123",
  KNOCK_FEED_CHANNEL_ID: "6a0bf9a6-0000-4000-8000-000000000000",
  KNOCK_SIGNING_KEY: signingKey,
  KNOCK_SECRET_API_KEY: "sk_test_secret",
};

function decodeClaims(token: string) {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("the Feed config the browser gets", () => {
  it("is only the public key and the feed channel id", () => {
    expect(getFeedConfig(configured)).toEqual({
      publicApiKey: "pk_test_123",
      feedChannelId: "6a0bf9a6-0000-4000-8000-000000000000",
    });
  });

  it.each([
    "KNOCK_PUBLIC_API_KEY",
    "KNOCK_FEED_CHANNEL_ID",
    "KNOCK_SIGNING_KEY",
  ])("is null when %s is missing, so the Feed stays empty", (missing) => {
    expect(getFeedConfig({ ...configured, [missing]: undefined })).toBeNull();
  });

  it("is null with no keys at all", () => {
    expect(getFeedConfig({})).toBeNull();
  });
});

describe("the signed user token", () => {
  it("is issued for the given user only", async () => {
    const token = await issueFeedToken(configured, 42);

    expect(token).not.toBeNull();
    expect(decodeClaims(token ?? "").sub).toBe("42");
  });

  it("expires, so a leaked token does not live forever", async () => {
    const claims = decodeClaims((await issueFeedToken(configured, 42)) ?? "");

    expect(claims.exp - claims.iat).toBeGreaterThan(0);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60 * 60);
  });

  it("is null with no signing key", async () => {
    expect(await issueFeedToken({}, 42)).toBeNull();
  });
});
