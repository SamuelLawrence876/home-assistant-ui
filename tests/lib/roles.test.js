/* Role rules — the display-layer gate on which tabs render.
   Enforcement is Home Assistant's own user groups; these tests cover the
   part of the decision that lives in this repo. */
import { describe, it, expect } from "vitest";
import { ROLES, ROLE_PENDING, deriveRole, allowedTabs, canSeeTab } from "../../src/lib/roles.js";

const ALL_TABS = ["overview", "lights", "media", "schedule", "climate", "workshop", "system"];

describe("deriveRole", () => {
  it("gives an admin account the full family view", () => {
    expect(deriveRole({ id: "admin-1", is_admin: true, is_owner: false }, true)).toBe(ROLES.FAMILY);
  });

  it("gives the owner account the full family view", () => {
    expect(deriveRole({ id: "owner-1", is_admin: false, is_owner: true }, true)).toBe(ROLES.FAMILY);
  });

  it("falls closed to guest for a user id nobody has mapped", () => {
    expect(deriveRole({ id: "who-is-this", is_admin: false, is_owner: false }, true)).toBe(ROLES.GUEST);
  });

  it("falls closed to guest when the user object carries no admin flags at all", () => {
    expect(deriveRole({ id: "bare" }, true)).toBe(ROLES.GUEST);
  });

  it("reports 'pending', not 'guest', while the user lookup is still in flight", () => {
    // Connected but auth/current_user has not come back. Collapsing this
    // one-round-trip window into guest silently rewrote every ?tab= deep
    // link to overview before the real role landed.
    const role = deriveRole(null, true);
    expect(role).toBe(ROLE_PENDING);
    expect(role).not.toBe(ROLES.GUEST);
  });

  it("falls closed to guest for a user id that names an Object.prototype key", () => {
    // USER_ROLE_MAP is a plain object, so a bare lookup answers for inherited
    // keys: "constructor" came back as the Object function, "__proto__" as
    // Object.prototype — non-nullish, so the `?? guest` default never fired.
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(deriveRole({ id, is_admin: false, is_owner: false }, true)).toBe(ROLES.GUEST);
    }
  });

  it("treats an undefined user the same as a missing one — still pending, not guest", () => {
    expect(deriveRole(undefined, true)).toBe(ROLE_PENDING);
  });

  it("shows everything when there is no live connection, so mock builds and the screenshot harness see all tabs", () => {
    // Nothing can actually be controlled without a socket, so this costs nothing.
    expect(deriveRole(null, false)).toBe(ROLES.FAMILY);
    expect(deriveRole({ id: "x", is_admin: false }, false)).toBe(ROLES.FAMILY);
  });
});

describe("allowedTabs", () => {
  it("gives family every tab", () => {
    expect(allowedTabs(ROLES.FAMILY)).toEqual(ALL_TABS);
  });

  it("gives a friend the media tab only", () => {
    expect(allowedTabs(ROLES.FRIEND)).toEqual(["media"]);
  });

  it("gives a guest the overview tab only", () => {
    expect(allowedTabs(ROLES.GUEST)).toEqual(["overview"]);
  });

  it("shows a pending user the same single tab as a guest", () => {
    expect(allowedTabs(ROLE_PENDING)).toEqual(["overview"]);
  });

  it("falls closed to the guest tab list for a role it does not recognise", () => {
    expect(allowedTabs("superuser")).toEqual(["overview"]);
    expect(allowedTabs(undefined)).toEqual(["overview"]);
    expect(allowedTabs(null)).toEqual(["overview"]);
  });

  it("does not answer for inherited object keys (roadmap I16)", () => {
    // `TAB_ACCESS[role] ?? TAB_ACCESS[GUEST]` used to read through the
    // prototype chain, so allowedTabs("constructor") handed back the Object
    // constructor and canSeeTab then threw "allowedTabs(...).includes is not a
    // function". Same shape as the ?lean=constructor bug fixed in theme.js.
    // Not reachable today — every value comes from deriveRole — but the
    // fail-closed guarantee this function exists to provide should not depend
    // on that. Expected: the guest tab list, like any other unrecognised role.
    expect(allowedTabs("constructor")).toEqual(["overview"]);
    expect(allowedTabs("toString")).toEqual(["overview"]);
    expect(allowedTabs("__proto__")).toEqual(["overview"]);
    expect(canSeeTab("constructor", "system")).toBe(false);
  });
});

describe("canSeeTab", () => {
  it("lets family open every tab", () => {
    for (const tab of ALL_TABS) expect(canSeeTab(ROLES.FAMILY, tab)).toBe(true);
  });

  it("keeps a friend out of everything except media", () => {
    expect(canSeeTab(ROLES.FRIEND, "media")).toBe(true);
    expect(canSeeTab(ROLES.FRIEND, "system")).toBe(false);
    expect(canSeeTab(ROLES.FRIEND, "overview")).toBe(false);
  });

  it("keeps a guest out of the system tab", () => {
    expect(canSeeTab(ROLES.GUEST, "overview")).toBe(true);
    expect(canSeeTab(ROLES.GUEST, "system")).toBe(false);
    expect(canSeeTab(ROLES.GUEST, "lights")).toBe(false);
  });

  it("says no to a tab that does not exist", () => {
    expect(canSeeTab(ROLES.FAMILY, "admin")).toBe(false);
    expect(canSeeTab(ROLES.FAMILY, undefined)).toBe(false);
  });
});
