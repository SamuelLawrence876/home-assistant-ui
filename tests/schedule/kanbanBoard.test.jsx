/* The Kanban board against a fake local_todo.

   The fake resolves `item` exactly the way Home Assistant's todo platform does:
   the FIRST item in list order whose uid OR summary matches. That rule is the
   whole of the same-name bug — a summary sent as `item` hit an older completed
   "Water plants" instead of the active one that was pressed — so the fake has
   to have it or the tests would pass against the broken code too.

   Also pinned: the undo window on delete (nothing is sent until it runs out,
   and the slot stays put so a double-click can't reach the next card), the
   honest read states (a column we couldn't read never reads as empty), the
   keyboard Move control, and that a failed add keeps what was typed. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const conn = { status: "ready", listeners: new Set() };
const ha = { lists: {}, calls: [], failReads: new Set(), failServices: new Set(), seq: 0 };

function setConn(s) {
  conn.status = s;
  conn.listeners.forEach((l) => l(s));
}

vi.mock("../../src/ha/useEntity.js", async () => {
  const React = await import("react");
  return {
    useConnectionStatus: () => {
      const [s, set] = React.useState(conn.status);
      React.useEffect(() => {
        conn.listeners.add(set);
        return () => { conn.listeners.delete(set); };
      }, []);
      return s;
    },
  };
});

vi.mock("../../src/ha/client.js", () => ({
  getTodoItems: async (id, status) => {
    if (ha.failReads.has(id)) throw new Error(`get_items ${id} failed`);
    return (ha.lists[id] || []).filter((it) => it.status === status).map((it) => ({ ...it }));
  },
  callService: async (domain, service, data) => {
    ha.calls.push({ service, ...data });
    if (ha.failServices.has(service)) throw new Error(`${service} failed`);
    const list = ha.lists[data.entity_id] || (ha.lists[data.entity_id] = []);
    // Home Assistant's _find_by_uid_or_summary: first match, uid or summary.
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
const servicesCalled = () => ha.calls.map((c) => c.service);

async function mount() {
  const r = render(<KanbanBoardCard />);
  await flush();
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  conn.status = "ready";
  conn.listeners.clear();
  ha.lists = { "todo.backlog": [], "todo.next": [], "todo.doing_2": [] };
  ha.calls = [];
  ha.failReads = new Set();
  ha.failServices = new Set();
  ha.seq = 0;
});
afterEach(() => vi.useRealTimers());

describe("Kanban targets HA items by uid", () => {
  beforeEach(() => {
    // local_todo appends, so the old completed copy sits first in the list.
    ha.lists["todo.backlog"] = [item("old", "Water plants", "completed"), item("new", "Water plants")];
  });

  it("deletes the card that was pressed, not an older same-named one", async () => {
    await mount();
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Delete Water plants" }));
    await advance(5000);
    expect(ha.calls).toContainEqual({ service: "remove_item", entity_id: "todo.backlog", item: "new" });
    expect(ha.lists["todo.backlog"].map((i) => i.uid)).toEqual(["old"]);
  });

  it("completes the card that was moved to Done, not the history item", async () => {
    await mount();
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Move Water plants" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Done" }));
    await flush();
    expect(ha.calls).toEqual([
      { service: "update_item", entity_id: "todo.backlog", item: "new", status: "completed" },
    ]);
    expect(ha.lists["todo.backlog"].every((i) => i.status === "completed")).toBe(true);
  });
});

describe("Kanban delete has an undo window", () => {
  beforeEach(() => {
    ha.lists["todo.backlog"] = [item("a", "Card A"), item("b", "Card B")];
  });

  it("holds the slot, so the second click of a double-click can't reach the next card's ×", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete Card A" }));
    const slots = col("Backlog").querySelectorAll(".kanban-card");
    // Card B has not slid up into Card A's place, and A's slot has no × in it.
    expect(slots[0].getAttribute("data-kanban-key")).toBe("a");
    expect(slots[0].className).toMatch(/pending-delete/);
    expect(within(slots[0]).queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(within(slots[0]).getByText("Deleted")).toBeInTheDocument();
    expect(servicesCalled()).toEqual([]);

    await advance(5000);
    expect(ha.calls).toEqual([{ service: "remove_item", entity_id: "todo.backlog", item: "a" }]);
    expect(ha.lists["todo.backlog"].map((i) => i.uid)).toEqual(["b"]);
  });

  it("Undo inside the window sends nothing and puts the card back", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete Card A" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo deleting Card A" }));
    await advance(10000);
    expect(servicesCalled()).toEqual([]);
    expect(screen.getByRole("button", { name: "Delete Card A" })).toBeInTheDocument();
  });

  it("moves keyboard focus × → Undo → × so it is never dropped", async () => {
    await mount();
    const x = screen.getByRole("button", { name: "Delete Card A" });
    x.focus();
    fireEvent.click(x);
    await flush();
    const undo = screen.getByRole("button", { name: "Undo deleting Card A" });
    expect(document.activeElement).toBe(undo);
    fireEvent.click(undo);
    await flush();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Card A" }));
  });

  it("leaving the tab inside the window still sends the delete", async () => {
    const { unmount } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete Card A" }));
    unmount();
    await flush();
    expect(ha.calls).toEqual([{ service: "remove_item", entity_id: "todo.backlog", item: "a" }]);
  });

  it("a delete Home Assistant refuses brings the card back", async () => {
    ha.failServices.add("remove_item");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete Card A" }));
    await advance(5000);
    expect(screen.getByRole("button", { name: "Delete Card A" })).toBeInTheDocument();
    expect(ha.lists["todo.backlog"].map((i) => i.uid)).toEqual(["a", "b"]);
  });
});

describe("Kanban Move control (keyboard route)", () => {
  beforeEach(() => {
    ha.lists["todo.backlog"] = [item("a", "Card A")];
  });

  it("moves across lists add-first, then removes the source by uid", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await flush();
    expect(ha.calls).toEqual([
      { service: "add_item", entity_id: "todo.next", item: "Card A" },
      { service: "remove_item", entity_id: "todo.backlog", item: "a" },
    ]);
    expect(within(col("Next")).getByText("Card A")).toBeInTheDocument();
  });

  it("lands keyboard focus on the destination column", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    const next = within(col("Backlog")).getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(col("Next"));
    // ...and the column announces itself by name when focus lands there.
    expect(screen.getByRole("group", { name: "Next" })).toBe(col("Next"));
  });

  it("Escape closes the Move row and gives focus back to its toggle", async () => {
    await mount();
    const toggle = screen.getByRole("button", { name: "Move Card A" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("group", { name: "Move Card A to" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Move Card A to" })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("a move that fails puts the card back where it was", async () => {
    ha.failServices.add("add_item");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Move Card A" }));
    fireEvent.click(within(col("Backlog")).getByRole("button", { name: "Next" }));
    await flush();
    expect(within(col("Backlog")).getByText("Card A")).toBeInTheDocument();
    expect(within(col("Next")).queryByText("Card A")).toBeNull();
  });
});

describe("Kanban read states are honest", () => {
  it("a column that can't be read says so instead of looking empty", async () => {
    ha.lists["todo.backlog"] = [item("a", "Card A")];
    ha.failReads.add("todo.next");
    await mount();
    expect(within(col("Next")).getByText("Couldn't read this column")).toBeInTheDocument();
    expect(within(col("Next")).getByText("—")).toBeInTheDocument();
    expect(within(col("Backlog")).getByText("Card A")).toBeInTheDocument();
    expect(screen.getByText("some columns couldn't be read")).toBeInTheDocument();
    // No total when a column is missing from it.
    expect(screen.getByText("Kanban")).toBeInTheDocument();
  });

  it("an empty column that read fine is just empty — 0, no warning", async () => {
    await mount();
    expect(within(col("Next")).getByText("0")).toBeInTheDocument();
    expect(within(col("Next")).queryByText(/couldn't/i)).toBeNull();
    expect(screen.getByText("Kanban · 0 items")).toBeInTheDocument();
  });

  it("a disconnected board says 'not connected', not 'loading…' forever, and offers no writes", async () => {
    conn.status = "disconnected";
    await mount();
    expect(screen.getByText("not connected")).toBeInTheDocument();
    expect(screen.queryByText("loading…")).toBeNull();
    expect(within(col("Next")).getByText("Not connected")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /^Add a task to/ })) expect(b).toBeDisabled();
  });

  it("cards already on screen stay when the socket drops, with the caveat said", async () => {
    ha.lists["todo.backlog"] = [item("a", "Card A")];
    await mount();
    act(() => setConn("disconnected"));
    expect(screen.getByText("Card A")).toBeInTheDocument();
    expect(screen.getByText("not connected · may be out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Card A" })).toBeDisabled();
  });

  it("a refresh that fails keeps the cards it had instead of emptying the column", async () => {
    ha.lists["todo.backlog"] = [item("a", "Card A")];
    ha.lists["todo.next"] = [item("d", "Card D", "completed")];
    await mount();
    ha.failReads.add("todo.backlog");
    ha.failReads.add("todo.next");
    act(() => setConn("disconnected"));
    act(() => setConn("ready"));
    await flush();
    expect(within(col("Backlog")).getByText("Card A")).toBeInTheDocument();
    expect(within(col("Backlog")).getByText(/Couldn't refresh/)).toBeInTheDocument();
    expect(within(col("Done")).getByText("Card D")).toBeInTheDocument();
  });
});

describe("Kanban add keeps the draft until Home Assistant has it", () => {
  async function typeAndAdd(text) {
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Next" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task summary" }), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await flush();
  }

  it("a failed add leaves the form open with what was typed, and says so", async () => {
    ha.failServices.add("add_item");
    await mount();
    await typeAndAdd("Book MOT");
    expect(screen.getByRole("textbox", { name: "Task summary" })).toHaveValue("Book MOT");
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn.t add/);
    expect(within(col("Next")).queryByText("Book MOT")).toBeNull();
  });

  it("a successful add closes the form and shows the task", async () => {
    await mount();
    await typeAndAdd("Book MOT");
    expect(screen.queryByRole("textbox", { name: "Task summary" })).toBeNull();
    expect(within(col("Next")).getByText("Book MOT")).toBeInTheDocument();
    expect(ha.lists["todo.next"].map((i) => i.summary)).toEqual(["Book MOT"]);
  });
});
