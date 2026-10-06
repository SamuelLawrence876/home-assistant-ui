/* describeHaError / toHaError, and what callService does with them.

   The property under test: whatever shape a failure arrives in, a person
   reading the toast or the error log gets words — never "3", never
   "[object Object]", never "undefined". */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { describeHaError, toHaError } from "../../src/ha/errors.js";

const sendWsMessage = vi.fn();
vi.mock("../../src/ha/socket.js", () => ({
  getEntity: () => undefined,
  getFreshAccessToken: async () => "t",
  getHaUrl: () => "https://ha.example.invalid",
  sendWsMessage: (...args) => sendWsMessage(...args),
  waitForConnection: async () => {},
}));

const { callService, onServiceError } = await import("../../src/ha/client.js");
const { getEntries, clearErrors } = await import("../../src/lib/errorLog.js");

const lostFrame = { type: "result", success: false, error: { code: 3, message: "Connection lost" } };

describe("describeHaError", () => {
  it("names the library's numeric codes", () => {
    expect(describeHaError(1)).toBe("Could not reach Home Assistant");
    expect(describeHaError(2)).toBe("Home Assistant session expired");
    expect(describeHaError(3)).toBe("Not connected to Home Assistant");
    expect(describeHaError(4)).toBe("Home Assistant URL not set");
    expect(describeHaError(99)).toBe("Home Assistant error 99");
  });

  it("reads the failed result frame a dropped in-flight command is rejected with", () => {
    expect(describeHaError(lostFrame)).toBe("Not connected to Home Assistant");
  });

  it("keeps Home Assistant's own messages and ordinary Errors as they are", () => {
    expect(describeHaError({ code: "not_found", message: "Service not found." })).toBe("Service not found.");
    expect(describeHaError(new Error("HA POST /api/x → 500"))).toBe("HA POST /api/x → 500");
    expect(describeHaError({ error: { code: "x", message: "inner" } })).toBe("inner");
    expect(describeHaError("plain words")).toBe("plain words");
  });

  it("never returns a non-string, an empty string or '[object Object]'", () => {
    for (const junk of [undefined, null, "", {}, [], { message: 42 }, { error: null }, NaN, Symbol("s")]) {
      const out = describeHaError(junk);
      expect(typeof out).toBe("string");
      expect(out).not.toBe("");
      expect(out).not.toContain("[object");
      expect(out).not.toContain("NaN");
    }
    const hostile = {};
    Object.defineProperty(hostile, "message", { get() { throw new Error("boom"); } });
    expect(describeHaError(hostile)).toBe("Unknown error");
  });
});

describe("toHaError", () => {
  it("wraps the two library shapes and keeps the code", () => {
    expect(toHaError(2)).toBeInstanceOf(Error);
    expect(toHaError(2)).toMatchObject({ message: "Home Assistant session expired", code: 2 });
    expect(toHaError(lostFrame)).toMatchObject({ message: "Not connected to Home Assistant", code: 3 });
  });

  it("returns everything else untouched", () => {
    const ha = { code: "unauthorized", message: "Unauthorized" };
    const err = new Error("x");
    expect(toHaError(ha)).toBe(ha);
    expect(toHaError(err)).toBe(err);
  });
});

describe("callService failures", () => {
  beforeEach(() => {
    clearErrors();
    sendWsMessage.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("logs and broadcasts words, not '3' or '[object Object]'", async () => {
    const heard = [];
    const off = onServiceError((e) => heard.push(e.message));

    sendWsMessage.mockRejectedValueOnce(3);
    await expect(callService("light", "turn_on", { entity_id: "light.bedroom" })).rejects.toBe(3);
    sendWsMessage.mockRejectedValueOnce(lostFrame);
    await expect(callService("switch", "turn_off", { entity_id: "switch.adguard" })).rejects.toBe(lostFrame);
    off();

    expect(heard).toEqual(["Not connected to Home Assistant", "Not connected to Home Assistant"]);
    expect(getEntries().map((e) => e.detail)).toEqual([
      "switch.adguard · Not connected to Home Assistant",
      "light.bedroom · Not connected to Home Assistant",
    ]);
  });
});
