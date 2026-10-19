/**
 * Shared webhook-target rules.
 *
 * This module is deliberately a leaf: it imports nothing from the backend, so
 * both the API layer (`ExportsService`, which validates at request time) and the
 * background layer (`ExportGenerationHandler`, which picks the target at
 * delivery time) can depend on it without creating an import cycle.
 *
 * The two call sites MUST agree. If the API accepts a request because a valid
 * https target exists while the handler picks a different, non-https target,
 * a signed, time-limited download reference gets posted in cleartext.
 */

/**
 * Whether a registered webhook target can actually be delivered to.
 *
 * Only absolute https URLs qualify:
 * - `http` would leak the signed download reference in transit.
 * - A relative or malformed value cannot be delivered to at all.
 */
export function isDeliverableWebhookUrl(
  webhookUrl: string | null | undefined,
): boolean {
  if (!webhookUrl) {
    return false;
  }

  try {
    return new URL(webhookUrl).protocol === "https:";
  } catch {
    return false;
  }
}
