/* Role-based access control — display layer.
 *
 * IMPORTANT: this only shapes the UI (which tabs render). Real enforcement
 * lives in Home Assistant's user groups:
 *   - family  → HA "Users" group  (can control everything, no admin/config)
 *   - friend  → HA "Users" group  (same enforcement as family; the narrower
 *               tab set here is UX, not security)
 *   - guest   → HA "Read-Only" group (service calls rejected by HA core —
 *               set via .storage/auth on the Pi; not exposed in HA's UI)
 * Admin/owner accounts always map to family.
 *
 * HA's `auth/current_user` returns only { id, name, is_owner, is_admin } —
 * no group membership — so non-admin users are mapped by user id below.
 * Unknown ids fail closed to guest.
 */

export const ROLES = Object.freeze({
  FAMILY: "family",
  FRIEND: "friend",
  GUEST: "guest",
});

/* HA user id → role, for non-admin users.
 * Find ids in HA: Settings → People → Users → click user (id is in the URL),
 * or `grep -A2 '"name"' /config/.storage/auth` on the Pi.
 * Keep this aligned with the user's HA group (see header comment). */
const USER_ROLE_MAP = {
  // "abc123…": ROLES.FAMILY,
  // "def456…": ROLES.FRIEND,
};

/* Which tabs each role sees. Family = everything. */
const TAB_ACCESS = {
  [ROLES.FAMILY]: ["overview", "lights", "media", "schedule", "climate", "workshop", "system"],
  [ROLES.FRIEND]: ["media"],
  [ROLES.GUEST]: ["overview"],
};

/* user: result of auth/current_user, or null.
 * connected: whether the HA WS is live.
 * Rules:
 *   - not connected (mock build / Pi offline) → family, so dev + the
 *     screenshot harness keep seeing all tabs (no real control is possible)
 *   - connected, user not resolved yet → guest (fail closed; the boot
 *     screen masks this window)
 *   - admin/owner → family; otherwise look up the id, default guest */
export function deriveRole(user, connected) {
  if (!connected) return ROLES.FAMILY;
  if (!user) return ROLES.GUEST;
  if (user.is_owner || user.is_admin) return ROLES.FAMILY;
  return USER_ROLE_MAP[user.id] ?? ROLES.GUEST;
}

export function allowedTabs(role) {
  return TAB_ACCESS[role] ?? TAB_ACCESS[ROLES.GUEST];
}

export function canSeeTab(role, tabId) {
  return allowedTabs(role).includes(tabId);
}
