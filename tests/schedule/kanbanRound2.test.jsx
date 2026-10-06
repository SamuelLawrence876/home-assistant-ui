/* The Kanban board against a fake local_todo that behaves like Home Assistant
   when a list is unavailable or gone — the 2026-10 round-2 review findings.

   The one behaviour this fake has that kanbanBoard.test.jsx's doesn't: HA
   SKIPS a service call aimed at an unavailable entity and still reports
   success. That is how a cross-list move into a dead list deleted the task —
   add_item "succeeded", then remove_item really did remove the only copy. And
   get_items gets no answer for a dead list, which getTodoItems now turns into
   a rejection (kanbanRound2GetItems.test.jsx) instead of an empty list.

   Also pinned: a card can't be moved or deleted again while its move is in
   flight (it used to land in two lists), keyboard focus goes into the Move
   row when it opens, a tap doesn't drag focus (and the phone's scroller)
   across to the target column, and Done never shows a count it never read. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const conn = { status: "ready", listeners: new Set() };
const ha = {
  lists: {}, calls: [], seq: 0, latency: 0,
  dead: new Map(),          // entity_id -> "unavailable" | "not_found"
  failReads: new Set(),     // "todo.x" or "todo.x:completed"
  skipWrites: new Set(),    // skipped like a dead list, but the entity still reads "ready"
  listeners: new Set(),
};
const listStatus = (id) => ha.dead.get(id) || "ready";
function setDead(id, status) {
  if (status) ha.dead.set(id, status); else ha.dead.delete(id);
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
      const status = connStatus !== "ready" ? "loading" : listStatus(id);
      return { entity: status === "not_found" ? undefined : { state: status === "ready" ? "0" : "unavailable" }, status };
    },
  };
});

const wait = () => (ha.latency ? new Promise((r) => setTimeout(r, ha.latency)) : null);

vi.mock("../../src/ha/client.js", () => ({
  getTodoItems: async (id, status) => {
    await wait();
    if (ha.dead.has(id) || ha.failReads.has(id) || ha.failReads.has(`${id}:${status}`)) {
      throw new Error(`todo.get_items: no answer for ${id}`);
    }
    return (ha.lists[id] || []).filter((it) => it.status === status).map((it) => ({ ...it }));
  },
  callService: async (domain, service, data) => {
    ha.calls.push({ service, ...data });
    await wait();
    // Home Assistant: an unavailable target is skipped, and the call succeeds.
    if (ha.dead.has(data.entity_id) || ha.skipWrites.has(data.entity_id)) return null;
    const list = ha.lists[data.entity_id] || (ha.lists[data.entity_id] = []);
    const find = () => list.findIndex((it) => it.uid === data.item || it.summary === data.item);
    if (service === "add_item") {
      list.push({ uid: `u${++ha.seq}`, summary: data.item, status: "needs_action", description: data.description });
    } else if (service === "remove_item") {
      const i = find();
      if (i < 0) throw new Error("item not found");
      list.splice(i, 1);
    } else if (service === "update_item") {
      const i = find();
      if (i < 0) throw new Error("item not found");
      list[i] = { ...list[i], status: data.status };
    }
    return null;
  },
}));

import { KanbanBoardCard } from "../../src/cards/schedule/KanbanBoardCard.jsx";

const item = (uid, summary, status = "needs_action") => ({ uid, summary, status });
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => {}); };
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); await flush(); };
const col = (label) => screen.getByText(label, { selector: ".kanban-col-head .label" }).closest(".kanban-col");
const count = (label) => col(label).querySelector(".kanban-col-head .count").textContent;
const services = () => ha.calls.map((c) => c.service);
const summaries = (id) => ha.lists[id].map((i) => i.summary);
/* The drag route, which has no disabled button in the way: what moveCard
   itself refuses is what this exercises. */
const dropOn = (label, payload) => fireEvent.drop(col(label), {
  dataTransfer: { getData: () => JSON.stringify(payload) },
});

async function mount() {
  const r = render(<KanbanBoardCard />);
  await flush();
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  conn.status = "ready";
  conn.listeners.clear();
  ha.lists = { "todo.backlog": [item("a", "Card A")], "todo.next": [], "todo.doing_2": [] };
  ha.calls = [];
  ha.seq = 0;
  ha.latency = 0;
  ha.dead = new Map();
  ha.failReads = new Set();
  ha.skipWrites = new Set();
  ha.listeners.clear();
});
afterEach(() => vi.useRealTimers());

describe("R11: an unavailable or missing list is unreadable, and nothing is written to it", () => {
  it("shows a dead list as '—' with the reason, never as an empty 0 column", async () => {
    setDead("todo.next", "unavailable");
    setDead("todo.doing_2", "not_found");
    await mount();
    expect(count("Next")).toBe("—");
    expect(within(col("Next")).getByText("List unavailable")).toBeInTheDocument();
    expect(count("In Progress")).toBe("—");
    expect(within(col("In Progress")).getByText("List not found")).toBeInTheDocument();
    expect(screen.getByText("some columns couldn't be read")).toBeInTheDocument();
    expect(screen.getByText("Kanban")).toBeInTheDocument(); // no total with a hole in it
  });

  it("offers no add, no Move-to and no drop into a dead list", async () => {
    setDead("todo.next", "unavailable");
    await mount();
    const add = screen.getByRole("button", { name: "Add a task to Next" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", "This list is unavailable in Home Assistant");
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    const opt = within(col("Backlog")).getByRole("button", { name: "Next" });
    expect(opt).toBeDisabled();
    expect(within(col("Backlog")).getByRole("button", { name: "Done" })).not.toBeDisabled();

    dropOn("Next", { uid: "a", col: "todo.backlog" });
    await advance(1000);
    expect(ha.calls).toEqual([]);
    expect(summaries("todo.backlog")).toEqual(["Card A"]);
    expect(within(col("Backlog")).getByText("Card A")).toBeInTheDocument();
  });

  it("never removes the source when HA skipped the add — the task stays where it was", async () => {
    // The entity still reads as available, but HA drops the write: the race
    // between a list going down and its state reaching the dashboard.
    ha.skipWrites.add("todo.next");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await advance(1000);
    expect(services()).toEqual(["add_item"]);
    expect(summaries("todo.backlog")).toEqual(["Card A"]);
    expect(within(col("Backlog")).getByText("Card A")).toBeInTheDocument();
    expect(within(col("Next")).queryByText("Card A")).toBeNull();
  });

  it("writes nothing at all if the target can't be read before the add", async () => {
    ha.failReads.add("todo.next:needs_action");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await advance(1000);
    expect(ha.calls).toEqual([]);
    expect(summaries("todo.backlog")).toEqual(["Card A"]);
  });

  it("a confirmed move still removes the source, by uid", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await advance(1000);
    expect(ha.calls).toEqual([
      { service: "add_item", entity_id: "todo.next", item: "Card A" },
      { service: "remove_item", entity_id: "todo.backlog", item: "a" },
    ]);
    expect(summaries("todo.next")).toEqual(["Card A"]);
    expect(summaries("todo.backlog")).toEqual([]);
  });

  it("an add form left open on a list that then goes down keeps the draft and says so", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Next" }));
    act(() => setDead("todo.next", "unavailable"));
    await flush();
    fireEvent.change(screen.getByRole("textbox", { name: "Task summary" }), { target: { value: "Typed while offline" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await flush();
    expect(ha.calls).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Task summary" })).toHaveValue("Typed while offline");
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn.t add/);
  });

  it("disables the cards of a dead list — HA would ignore their delete or move too", async () => {
    setDead("todo.backlog", "unavailable");
    ha.lists["todo.next"] = [item("n", "Card N")];
    await mount();
    act(() => setDead("todo.next", "unavailable"));
    await flush();
    expect(screen.getByRole("button", { name: "Delete Card N" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Card N" })).toBeDisabled();
    // ...and keeps them on screen with the caveat: unavailable isn't "gone".
    expect(within(col("Next")).getByText("List unavailable · may be out of date")).toBeInTheDocument();
  });

  it("reads a list again when it comes back", async () => {
    setDead("todo.next", "unavailable");
    ha.lists["todo.next"] = [item("n", "Card N")];
    await mount();
    expect(count("Next")).toBe("—");
    act(() => setDead("todo.next", null));
    await flush();
    expect(count("Next")).toBe("1");
    expect(within(col("Next")).getByText("Card N")).toBeInTheDocument();
    expect(screen.getByText("drag cards between columns")).toBeInTheDocument();
  });
});

describe("R12: a card can't be moved or deleted again while its move is in flight", () => {
  beforeEach(() => { ha.latency = 800; });

  it("refuses a second move and a delete until the first settles, then moves the new item", async () => {
    await mount();
    await advance(5000); // the first read, slowed down like everything else
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await flush();

    // Drawn in Next already, but every control on it is off...
    const moved = within(col("Next")).getByText("Card A").closest(".kanban-card");
    expect(moved.getAttribute("draggable")).toBe("false");
    expect(within(moved).getByRole("button", { name: "Move Card A" })).toBeDisabled();
    expect(within(moved).getByRole("button", { name: "Delete Card A" })).toBeDisabled();
    // ...and the drag route, which has no disabled button, is refused too.
    dropOn("In Progress", { uid: "a", col: "todo.next" });
    await flush();
    expect(within(col("In Progress")).queryByText("Card A")).toBeNull();

    await advance(5000); // the move settles and the board re-reads
    expect(ha.calls).toEqual([
      { service: "add_item", entity_id: "todo.next", item: "Card A" },
      { service: "remove_item", entity_id: "todo.backlog", item: "a" },
    ]);

    fireEvent.click(within(col("Next")).getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Next")).getByRole("button", { name: "In Progress" }));
    await advance(10000);
    expect(ha.calls.slice(2)).toEqual([
      { service: "add_item", entity_id: "todo.doing_2", item: "Card A" },
      { service: "remove_item", entity_id: "todo.next", item: "u1" },
    ]);
    expect(summaries("todo.backlog")).toEqual([]);
    expect(summaries("todo.next")).toEqual([]);
    expect(summaries("todo.doing_2")).toEqual(["Card A"]);
  });

  it("gives the moved card its new list and uid straight away, before any re-read", async () => {
    ha.latency = 0;
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await flush(); // the move has settled; the 500 ms re-read has not run
    const moved = within(col("Next")).getByText("Card A").closest(".kanban-card");
    expect(moved.getAttribute("data-kanban-key")).toBe("u1");
    fireEvent.click(within(moved).getByRole("button", { name: "Delete Card A" }));
    await advance(5000);
    expect(ha.calls.at(-1)).toEqual({ service: "remove_item", entity_id: "todo.next", item: "u1" });
    expect(summaries("todo.next")).toEqual([]);
  });
});

describe("R14/R15: focus follows the keyboard, not the finger", () => {
  it("a keyboard open of Move puts focus on the first option, not on Delete", async () => {
    await mount();
    const toggle = screen.getByRole("button", { name: "Move Card A" });
    toggle.focus();
    fireEvent.click(toggle, { detail: 0 }); // Enter / Space
    await flush();
    expect(document.activeElement).toBe(within(col("Backlog")).getByRole("button", { name: "Next" }));
  });

  it("skips a disabled first option", async () => {
    setDead("todo.next", "unavailable");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }), { detail: 0 });
    await flush();
    expect(document.activeElement).toBe(within(col("Backlog")).getByRole("button", { name: "In Progress" }));
  });

  it("a mouse open leaves focus alone", async () => {
    await mount();
    const toggle = screen.getByRole("button", { name: "Move Card A" });
    toggle.focus();
    fireEvent.click(toggle, { detail: 1 });
    await flush();
    expect(document.activeElement).toBe(toggle);
  });

  it("a tap on a Move-to option doesn't hand focus to (and scroll to) the target column", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }), { detail: 1 });
    const done = within(col("Backlog")).getByRole("button", { name: "Done" });
    done.focus(); // Chromium focuses a tapped button
    fireEvent.click(done, { detail: 1 });
    await flush();
    expect(document.activeElement).not.toBe(col("Done"));
    expect(within(col("Done")).getByText("Card A")).toBeInTheDocument();
  });
});

describe("R19: the board never states a count it didn't read", () => {
  it("says the whole board couldn't be read when no column could", async () => {
    ha.failReads = new Set(["todo.backlog", "todo.next", "todo.doing_2"]);
    await mount();
    expect(screen.getByText("board couldn't be read")).toBeInTheDocument();
    expect(screen.queryByText("some columns couldn't be read")).toBeNull();
  });

  it("Done shows '—' when one list's completed items were never read, not the partial count", async () => {
    ha.lists["todo.backlog"].push(item("d1", "Done one", "completed"), item("d2", "Done two", "completed"));
    ha.lists["todo.next"] = [item("d3", "Order filament", "completed")];
    ha.failReads.add("todo.next:completed");
    await mount();
    expect(count("Done")).toBe("—");
    expect(within(col("Done")).getByText("Couldn't read all of this column")).toBeInTheDocument();
    // The cards it did read are still shown.
    expect(within(col("Done")).getByText("Done one")).toBeInTheDocument();
  });

  it("Done keeps a count from a list it HAS read, with the caveat, when only the refresh fails", async () => {
    ha.lists["todo.next"] = [item("d3", "Order filament", "completed")];
    await mount();
    expect(count("Done")).toBe("1");
    ha.failReads.add("todo.next:completed");
    act(() => conn.listeners.forEach((l) => l("disconnected")));
    act(() => conn.listeners.forEach((l) => l("ready")));
    await flush();
    expect(count("Done")).toBe("1");
    expect(within(col("Done")).getByText("Couldn't refresh · may be out of date")).toBeInTheDocument();
  });
});
