/* Round 4d review of the Kanban board (D16, D5/D21).

   D16: a cross-list move checked the source list still held the task, by uid
   — and then added the CARD's summary, description and due date to the
   target and removed the original. A rename, tag or due date changed on
   another device moves no entity, so the board hadn't re-read: the edit was
   copied over with the old one and silently lost. The move now adds the item
   as its own pre-check read it, and draws that.

   D5/D21: after Restart HA a list HA hasn't loaded yet reads "loading" while
   the socket is up, and HA can't answer get_items for it. Its column said
   "Couldn't refresh · may be out of date" with a Retry that failed the same
   way every time, and Done said the same — for a list that simply hadn't
   arrived. Now it is a wait.

   The fake is kanbanRound4c.test.jsx's (local_todo on the points that matter,
   lists HA hasn't sent yet, lists it can't read yet), with add_item keeping
   the description and due date it is sent. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const conn = { status: "ready", listeners: new Set() };
const ha = {
  lists: {}, calls: [], reads: 0, seq: 0, clock: 0, updated: {}, listeners: new Set(), logged: [],
  held: new Set(),        // HA hasn't sent this list on this connection: no entity, "loading"
  failing: new Set(),     // get_items for this list fails (local_todo not loaded yet)
};
function setConn(s) {
  conn.status = s;
  conn.listeners.forEach((l) => l(s));
}
const openCount = (id) => (ha.lists[id] || []).filter((it) => it.status === "needs_action").length;
function touch(id) {
  ha.updated[id] = `2026-10-07T12:00:00.${String(++ha.clock).padStart(3, "0")}Z`;
  ha.listeners.forEach((l) => l());
}

vi.mock("../../src/ha/useEntity.js", async () => {
  const React = await import("react");
  const useConnectionStatus = () => {
    const [s, set] = React.useState(conn.status);
    React.useEffect(() => {
      conn.listeners.add(set);
      return () => { conn.listeners.delete(set); };
    }, []);
    return s;
  };
  return {
    useConnectionStatus,
    useEntityStatus: (id) => {
      const connStatus = useConnectionStatus();
      const [, tick] = React.useReducer((n) => n + 1, 0);
      React.useEffect(() => {
        ha.listeners.add(tick);
        return () => { ha.listeners.delete(tick); };
      }, []);
      if (ha.held.has(id)) return { entity: null, status: "loading" };
      return {
        entity: { entity_id: id, state: String(openCount(id)), last_updated: ha.updated[id] },
        status: connStatus === "ready" ? "ready" : "loading",
      };
    },
  };
});

vi.mock("../../src/ha/client.js", () => ({
  getTodoItems: async (id, status) => {
    ha.reads += 1;
    if (ha.failing.has(id)) throw new Error(`todo.get_items: ${id} not loaded`);
    return (ha.lists[id] || []).filter((it) => it.status === status).map((it) => ({ ...it }));
  },
  callService: async (domain, service, data) => {
    ha.calls.push({ service, ...data });
    const list = ha.lists[data.entity_id] || (ha.lists[data.entity_id] = []);
    const find = () => list.findIndex((it) => it.uid === data.item || it.summary === data.item);
    if (service === "add_item") {
      const due = data.due_date || data.due_datetime;
      list.push({
        uid: `u${++ha.seq}`, summary: data.item, status: "needs_action",
        ...(data.description ? { description: data.description } : {}),
        ...(due ? { due } : {}),
      });
    } else if (service === "remove_item" || service === "update_item") {
      const i = find();
      if (i < 0) throw new Error("Unable to find to-do list item");
      if (service === "remove_item") list.splice(i, 1);
      else list[i] = { ...list[i], status: data.status };
    }
    touch(data.entity_id);
    return null;
  },
}));

vi.mock("../../src/lib/errorLog.js", () => ({ logError: (entry) => { ha.logged.push(entry); } }));

import { KanbanBoardCard } from "../../src/cards/schedule/KanbanBoardCard.jsx";

const ONE_READ = 6; // 3 lists × (needs_action + completed)
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => {}); };
const advance = async (ms) => {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t)); });
  }
  await flush();
};
const col = (label) => screen.getByText(label, { selector: ".kanban-col-head .label" }).closest(".kanban-col");
const count = (label) => col(label).querySelector(".kanban-col-head .count").textContent;
const note = (label) => col(label).querySelector(".kanban-col-note")?.firstChild?.textContent ?? null;
const inCol = (label, name) => Boolean(within(col(label)).queryByText(name));
const retryIn = (label) => within(col(label)).queryByRole("button", { name: new RegExp(`^Retry(ing)? ${label}$`) });
const cardIn = (label, name) => within(col(label)).getByText(name, { selector: ".summary" }).closest("[data-kanban-key]");
async function moveTo(cardName, fromLabel, toLabel) {
  fireEvent.click(within(col(fromLabel)).getByRole("button", { name: `Move ${cardName}` }));
  fireEvent.click(within(col(fromLabel)).getByRole("button", { name: toLabel }));
  await flush();
}
async function mount() {
  render(<KanbanBoardCard />);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  conn.status = "ready";
  conn.listeners.clear();
  ha.lists = {
    "todo.backlog": [{ uid: "a", summary: "Card A", status: "needs_action" }],
    "todo.next": [
      { uid: "nx-0004", summary: "Book boiler service", status: "needs_action", due: "2026-10-08T10:00:00+01:00" },
      { uid: "n2", summary: "Order filament", status: "needs_action", description: "#print" },
      { uid: "n3", summary: "Fix the gate", status: "needs_action" },
      { uid: "n4", summary: "Old task", status: "completed" },
    ],
    "todo.doing_2": [],
  };
  ha.calls = [];
  ha.reads = 0;
  ha.seq = 0;
  ha.clock = 0;
  ha.updated = { "todo.backlog": "t0", "todo.next": "t0", "todo.doing_2": "t0" };
  ha.listeners.clear();
  ha.logged = [];
  ha.held = new Set();
  ha.failing = new Set();
});
afterEach(() => vi.useRealTimers());

describe("D16: a cross-list move carries the task as HA holds it now", () => {
  it("keeps a rename, a tag and a due date made elsewhere, and draws them", async () => {
    await mount();
    // Changed on another device. A rename moves no entity, so no change read comes.
    act(() => {
      Object.assign(ha.lists["todo.next"][0], { summary: "Book boiler service - call Tue 9am", description: "#urgent", due: "2026-10-13" });
    });
    expect(inCol("Next", "Book boiler service")).toBe(true);   // the board hasn't re-read
    await moveTo("Book boiler service", "Next", "In Progress");
    expect(ha.calls).toEqual([
      { service: "add_item", entity_id: "todo.doing_2", item: "Book boiler service - call Tue 9am", due_date: "2026-10-13", description: "#urgent" },
      { service: "remove_item", entity_id: "todo.next", item: "nx-0004" },
    ]);
    expect(ha.lists["todo.doing_2"]).toEqual([
      { uid: "u1", summary: "Book boiler service - call Tue 9am", status: "needs_action", description: "#urgent", due: "2026-10-13" },
    ]);
    expect(ha.logged).toEqual([]);
    // Drawn as it landed straight away — before the move's own re-read.
    expect(ha.reads).toBe(ONE_READ + 3);          // the source check + addConfirmed's two
    const card = cardIn("In Progress", "Book boiler service - call Tue 9am");
    expect(card.getAttribute("data-kanban-key")).toBe("u1");
    expect(within(card).getByText("urgent")).toBeInTheDocument();
    expect(screen.queryByText("Book boiler service")).toBeNull();
    await advance(1000);
    expect(ha.reads).toBe(2 * ONE_READ + 3);
    expect(inCol("In Progress", "Book boiler service - call Tue 9am")).toBe(true);
  });

  it("doesn't bring back a tag or a due date cleared elsewhere", async () => {
    await mount();
    act(() => {
      delete ha.lists["todo.next"][0].due;
      delete ha.lists["todo.next"][1].description;
    });
    await moveTo("Book boiler service", "Next", "In Progress");
    await moveTo("Order filament", "Next", "Backlog");
    expect(ha.calls.filter((c) => c.service === "add_item")).toEqual([
      { service: "add_item", entity_id: "todo.doing_2", item: "Book boiler service" },
      { service: "add_item", entity_id: "todo.backlog", item: "Order filament" },
    ]);
    expect(within(cardIn("Backlog", "Order filament")).queryByText("print")).toBeNull();
    expect(within(cardIn("In Progress", "Book boiler service")).queryByText(/^due ·/)).toBeNull();
  });

  it("does the same moving a completed task out of Done to another list", async () => {
    await mount();
    act(() => { Object.assign(ha.lists["todo.next"][3], { summary: "Old task, renamed", description: "#later" }); });
    await moveTo("Old task", "Done", "Backlog");
    expect(ha.calls).toEqual([
      { service: "add_item", entity_id: "todo.backlog", item: "Old task, renamed", description: "#later" },
      { service: "remove_item", entity_id: "todo.next", item: "n4" },
    ]);
    expect(inCol("Backlog", "Old task, renamed")).toBe(true);
  });
});

describe("D5/D21: a list HA is still loading reads as loading, not as a failure", () => {
  async function reconnectWithNextLoading() {
    await mount();
    act(() => setConn("disconnected"));
    ha.held.add("todo.next");
    ha.failing.add("todo.next");
    act(() => setConn("ready"));
    await flush();
  }
  const arrive = () => act(() => {
    ha.held.delete("todo.next");
    ha.failing.delete("todo.next");
    ha.listeners.forEach((l) => l());
  });

  it("its column and Done say they're waiting, with no Retry; the meta line says loading", async () => {
    await reconnectWithNextLoading();
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(note("Next")).toBe("Loading… · may be out of date");
    expect(count("Next")).toBe("3");              // what it read before, said to be so
    expect(retryIn("Next")).toBeNull();
    expect(note("Done")).toBe("Waiting for a list to load · may be out of date");
    expect(retryIn("Done")).toBeNull();
    expect(screen.queryByText(/Couldn't/)).toBeNull();
    expect(screen.getByText("loading…")).toBeInTheDocument();
    expect(screen.getByText("Kanban")).toBeInTheDocument();   // no total with a hole in it
    // Through both automatic retries (8 s, 20 s), which fail the same way: still a wait.
    await advance(30_000);
    expect(ha.reads).toBe(4 * ONE_READ);
    expect(note("Next")).toBe("Loading… · may be out of date");
    expect(screen.queryByText(/Couldn't/)).toBeNull();
  });

  it("recovers by itself once the list arrives", async () => {
    await reconnectWithNextLoading();
    await arrive();
    await advance(1000);
    expect(ha.reads).toBe(3 * ONE_READ);
    expect(note("Next")).toBeNull();
    expect(note("Done")).toBeNull();
    expect(screen.getByText("drag cards between columns")).toBeInTheDocument();
    expect(screen.getByText("Kanban · 5 items")).toBeInTheDocument();
  });

  it("a list that really fails while another is loading still says so, with its Retry", async () => {
    await reconnectWithNextLoading();
    ha.failing.add("todo.backlog");
    await advance(8000);                          // the first automatic retry
    expect(note("Backlog")).toBe("Couldn't refresh · may be out of date");
    expect(retryIn("Backlog")).not.toBeNull();
    expect(note("Next")).toBe("Loading… · may be out of date");
    expect(retryIn("Next")).toBeNull();
    // Done reads Backlog's completed items too, and that read really failed:
    // not "waiting", and its Retry is offered.
    expect(note("Done")).not.toMatch(/Waiting for a list/);
    expect(retryIn("Done")).not.toBeNull();
    expect(screen.getByText("some columns couldn't be read")).toBeInTheDocument();
  });
});
