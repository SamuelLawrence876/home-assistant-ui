/* callService's `expectDisconnect` option.

   Restart HA, Reboot Pi and the Core / OS / Supervisor installs end with Home
   Assistant dropping the WebSocket before it answers, so the library rejects
   the in-flight call with "connection lost" — and the error log and a toast
   said the action failed when it had almost certainly worked. With the
   option, that one rejection means "sent". The property under test is the
   other half as much as that one: a call that never left (the socket was
   already down, or the library refused to send) and every other failure
   still log and throw, and nothing changes for calls without the option. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = vi.hoisted(() => ({ status: "ready" }));
const sendWsMessage = vi.fn();
vi.mock("../../src/ha/socket.js", () => ({
  getConnectionStatus: () => conn.status,
  getEntity: () => undefined,
  getFreshAccessToken: async () => "t",
  getHaUrl: () => "https://ha.example.invalid",
  sendWsMessage: (...args) => sendWsMessage(...args),
  waitForConnection: async () => {},
}));

const { callService, onServiceError } = await import("../../src/ha/client.js");
const { getEntries, clearErrors } = await import("../../src/lib/errorLog.js");
const { toHaError } = await import("../../src/ha/errors.js");

const EXPECT = { expectDisconnect: true };
const lostFrame = () => ({ type: "result", success: false, error: { code: 3, message: "Connection lost" } });

/* What socket.js#sendWsMessage really rejects with: the library's frame run
   through toHaError — and, for a command that was in flight, the library has
   announced the drop (status "disconnected") before the rejection lands. */
function dropsMidCall(err = toHaError(lostFrame())) {
  sendWsMessage.mockImplementationOnce(() => {
    conn.status = "disconnected";
    return Promise.reject(err);
  });
}

let heard;
let off;
beforeEach(() => {
  clearErrors();
  sendWsMessage.mockReset();
  conn.status = "ready";
  heard = [];
  off?.();
  off = onServiceError((e) => heard.push(`${e.domain}.${e.service}`));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("callService with expectDisconnect", () => {
  it("treats the connection dropping mid-call as sent: no log, no toast", async () => {
    dropsMidCall();
    await expect(callService("homeassistant", "restart", {}, undefined, EXPECT)).resolves.toEqual({
      connectionLost: true,
    });
    expect(getEntries()).toEqual([]);
    expect(heard).toEqual([]);
  });

  it("reads the library's raw in-flight frame the same way", async () => {
    dropsMidCall(lostFrame());
    await expect(
      callService("update", "install", { entity_id: "update.home_assistant_core_update" }, undefined, EXPECT),
    ).resolves.toEqual({ connectionLost: true });
    expect(getEntries()).toEqual([]);
  });

  it("passes a real answer through untouched", async () => {
    sendWsMessage.mockResolvedValueOnce({ context: { id: "c" } });
    await expect(callService("hassio", "host_reboot", {}, undefined, EXPECT)).resolves.toEqual({
      context: { id: "c" },
    });
  });

  it("still fails a call made while the socket was already down", async () => {
    conn.status = "disconnected";
    const err = toHaError(3);
    sendWsMessage.mockRejectedValueOnce(err);
    await expect(callService("homeassistant", "restart", {}, undefined, EXPECT)).rejects.toBe(err);
    expect(getEntries().map((e) => e.message)).toEqual(["homeassistant.restart failed"]);
    expect(heard).toEqual(["homeassistant.restart"]);
  });

  it("still fails when the library refused to send (its bare code)", async () => {
    dropsMidCall(3);
    await expect(callService("hassio", "host_reboot", {}, undefined, EXPECT)).rejects.toBe(3);
    expect(heard).toEqual(["hassio.host_reboot"]);
  });

  it("still fails a send refused into a closing socket, before the drop was announced", async () => {
    // Error{code: 3}, but the status never left "ready": nothing was in flight.
    const err = toHaError(3);
    sendWsMessage.mockRejectedValueOnce(err);
    await expect(callService("homeassistant", "restart", {}, undefined, EXPECT)).rejects.toBe(err);
    expect(heard).toEqual(["homeassistant.restart"]);
  });

  it("still logs and throws Home Assistant's own refusal", async () => {
    const refusal = { code: "home_assistant_error", message: "The system cannot restart because the configuration is not valid" };
    sendWsMessage.mockRejectedValueOnce(refusal);
    await expect(callService("homeassistant", "restart", {}, undefined, EXPECT)).rejects.toBe(refusal);
    expect(getEntries()[0].detail).toMatch(/configuration is not valid/);
    expect(heard).toEqual(["homeassistant.restart"]);
  });
});

describe("callService without the option", () => {
  it("a dropped connection is a failure, exactly as before", async () => {
    dropsMidCall();
    await expect(callService("script", "reload")).rejects.toMatchObject({ code: 3 });
    expect(getEntries().map((e) => e.message)).toEqual(["script.reload failed"]);
    expect(heard).toEqual(["script.reload"]);
  });
});
