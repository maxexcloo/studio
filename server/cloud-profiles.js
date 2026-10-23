// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A provider-backed cloud profile (Grok): it runs at the provider, not on a worker. Access
 * profiles grant these through their Cloud Models feature rather than one by one, and nothing
 * ever picks one by itself.
 */
export const isCloudProfile = (profile) =>
  profile?.family === "grok" || /^grok/i.test(String(profile?.id || ""));
