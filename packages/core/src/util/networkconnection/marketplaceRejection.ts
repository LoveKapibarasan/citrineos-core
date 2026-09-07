// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Tell the marketplace platform about a handshake this server refused.
 *
 * The platform holds a subscription for every station it provisioned, and
 * that is how it learns about connections and disconnections. It cannot learn
 * about a *refusal* the same way: the upgrade is rejected before any
 * subscription for that station is loaded, and an unknown identifier has no
 * subscription to load at all. So a host who mistyped their password, or
 * their station id, sees nothing -- which is the half of the connection log
 * they actually need (ai-charge/citrineos-payment#468).
 *
 * Fire and forget, and deliberately so: a charger being refused is already a
 * bad moment, and it must not be made slower by a reporting endpoint that is
 * down. Nothing here throws into the upgrade path.
 *
 * Off unless MARKETPLACE_STATION_EVENT_URL and MARKETPLACE_STATION_EVENT_SECRET
 * are both set, so a deployment that is not a marketplace behaves exactly as
 * it did before.
 */

/** What the platform's vocabulary can say, from which filter refused. */
export function rejectionReason(error: any): string {
  const message = String(error?.message ?? '');
  const name = String(error?.constructor?.name ?? '');

  if (name === 'UpgradeUnknownError' || /unknown identifier/i.test(message)) {
    return 'unknown_station';
  }
  if (/securityprofile not allowed/i.test(message)) {
    return 'profile_below_floor';
  }
  if (/already connected/i.test(message)) {
    return 'already_connected';
  }
  if (/unauthorized|auth header/i.test(message)) {
    return 'bad_credential';
  }
  return 'unknown';
}

export async function reportRejection(
  presentedStationId: string,
  error: any,
  securityProfile?: number,
): Promise<void> {
  const url = process.env.MARKETPLACE_STATION_EVENT_URL;
  const secret = process.env.MARKETPLACE_STATION_EVENT_SECRET;
  if (!url || !secret || !presentedStationId) {
    return;
  }

  try {
    const controller = new AbortController();
    // The charger is already being turned away; this must not hold anything
    // open while a slow endpoint thinks about it.
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`${url}?token=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ocppConnectionName: presentedStationId,
        event: 'rejected',
        reason: rejectionReason(error),
        securityProfile,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
  } catch {
    // Swallowed on purpose. See the module comment: this is diagnostics for
    // somebody else, and it must not become a second failure here.
  }
}
