import { PostHog } from "posthog-node";

// Construct a fresh client per call. Serverless functions shut the client
// down to flush events, which makes a cached instance unusable on warm reuse.
export function getPostHog() {
  if (!process.env.POSTHOG_API_KEY) return null;
  return new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });
}
