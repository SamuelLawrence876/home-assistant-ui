/* getTodoItems — a list Home Assistant didn't answer for is a failed read.

   HA skips an unavailable entity in an entity service call (or, when nothing
   is left to call, refuses the call outright), so todo.get_items for a dead
   list comes back with that list missing from `response`. This used to read
   as `[]`, and the Kanban showed the dead list as an empty "0" column and
   offered it as a move target. An empty list that HA really returned must
   still read as empty. */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* A plain function, not vi.fn(): with a vi.fn() reset in beforeEach, a
   rejecting implementation failed the test under Vitest 4 even though the
   rejection was awaited and handled — and a rejection is the case under test. */
const ws = { sent: [], reply: async () => null };
vi.mock("../../src/ha/socket.js", () => ({
  getEntity: () => undefined,
  getFreshAccessToken: async () => "test-token",
  getHaUrl: () => "https://ha.example.invalid",
  sendWsMessage: (msg) => { ws.sent.push(msg); return ws.reply(msg); },
  waitForConnection: async () => {},
}));

const { getTodoItems } = await import("../../src/ha/client.js");

beforeEach(() => { ws.sent = []; ws.reply = async () => null; });

describe("getTodoItems", () => {
  it("returns the items HA returned, and asks for the status it was given", async () => {
    ws.reply = async () => ({ response: { "todo.next": { items: [{ uid: "1", summary: "A" }] } } });
    await expect(getTodoItems("todo.next", "needs_action")).resolves.toEqual([{ uid: "1", summary: "A" }]);
    expect(ws.sent).toEqual([expect.objectContaining({
      domain: "todo",
      service: "get_items",
      service_data: { entity_id: "todo.next", status: "needs_action" },
      return_response: true,
    })]);
  });

  it("an empty list HA really returned is still empty", async () => {
    ws.reply = async () => ({ response: { "todo.next": { items: [] } } });
    await expect(getTodoItems("todo.next", "completed")).resolves.toEqual([]);
  });

  it("rejects when the list is missing from the response (unavailable, skipped by HA)", async () => {
    ws.reply = async () => ({ response: {} });
    await expect(getTodoItems("todo.next", "needs_action")).rejects.toThrow(/todo\.next/);
  });

  it("rejects on a response with no items array, or no response at all", async () => {
    ws.reply = async () => ({ response: { "todo.next": {} } });
    await expect(getTodoItems("todo.next")).rejects.toThrow();
    ws.reply = async () => null;
    await expect(getTodoItems("todo.next")).rejects.toThrow();
  });

  it("passes on HA's own refusal", async () => {
    ws.reply = async () => {
      throw new Error("Service call requested response data but did not match any entities");
    };
    await expect(getTodoItems("todo.gone")).rejects.toThrow(/did not match/);
  });
});
