/* The Kanban board picks up changes made elsewhere — the 2026-10 round-4 hunt
   finding lifecycle#2.

   The board used to read its lists at mount and then only after its own
   writes, its bounded retries and Retry. A task added, completed or deleted on
   another device (the phone, the HA app, Assist, an automation) never showed
   for as long as the tab stayed open, under a meta line that said nothing was
   wrong. And moving such a stale card made it worse: a task deleted elsewhere
   was added to the target list and so brought back.

   The fake here behaves like local_todo on the one point that matters: every
   write to a list gives its entity a new state (the open-item count) and a new
   last_updated, pushed to whoever subscribes — touch(). A rename moves
   neither, which is why the board also has a slow heartbeat. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const conn = { status: "ready", listeners: new Set() };
const ha = {
  lists: {}, calls: [], reads: 0, readLog: [], seq: 0, clock: 0,
  updated: {}, listeners: new Set(), logged: [], rtt: 0,
};
/* A slow link, for the tests that need one (`ha.rtt`, in ms): a call reaches
   Home Assistant half a round trip after it's sent, HA acts there — reads the
   list, or writes it — and the answer (and, for a write, the entity's new
   state) arrives half a round trip later. At 0 every call stays synchronous,
   which is what every other test here assumes. */
const halfTrip = () => (ha.rtt ? new Promise((r) => { setTimeout(r, ha.rtt / 2); }) : null);
function setConn(s) {
  conn.status = s;
  conn.listeners.forEach((l) => l(s));
}
const openCount = (id) => (ha.lists[id] || []).filter((it) => it.status === "needs_action").length;
/* What Home Assistant does after a write to a list: new state, new
   last_updated, and every subscriber told. */
function touch(id) {
  ha.updated[id] = `2026-10-06T12:00:00.${String(++ha.clock).padStart(3, "0")}Z`;
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
    ha.readLog.push(`${id}:${status}`);
    if (ha.rtt) await halfTrip();
    const items = (ha.lists[id] || []).filter((it) => it.status === status).map((it) => ({ ...it }));
    if (ha.rtt) await halfTrip();
    return items;
  },
  callService: async (domain, service, data) => {
    ha.calls.push({ service, ...data });
    if (ha.rtt) await halfTrip();
    const list = ha.lists[data.entity_id] || (ha.lists[data.entity_id] = []);
    // Home Assistant's _find_by_uid_or_summary: first match, uid or summary.
    const find = () => list.findIndex((it) => it.uid === data.item || it.summary === data.item);
    if (service === "add_item") {
      list.push({ uid: `u${++ha.seq}`, summary: data.item, status: "needs_action" });
    } else if (service === "remove_item" || service === "update_item") {
      const i = find();
      if (i < 0) throw new Error("Unable to find to-do list item");
      if (service === "remove_item") list.splice(i, 1);
      else list[i] = { ...list[i], status: data.status };
    }
    if (ha.rtt) await halfTrip();
    touch(data.entity_id);
    return null;
  },
}));

vi.mock("../../src/lib/errorLog.js", () => ({ logError: (entry) => { ha.logged.push(entry); } }));

import { KanbanBoardCard } from "../../src/cards/schedule/KanbanBoardCard.jsx";
import { listStamp, listsMoved } from "../../src/cards/schedule/kanbanUtils.js";

const ONE_READ = 6; // 3 lists × (needs_action + completed)
const MIN = 60_000;
const item = (uid, summary, status = "needs_action") => ({ uid, summary, status });
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => {}); };
/* In steps of at most 1 s, each its own act(): React holds a render queued
   inside act() until the act ends, so one long advance would let a timer fire
   but not the read it asks for — and the timer that read sets would never be
   set. (Same helper as kanbanRetry.test.jsx.) */
const advance = async (ms) => {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t)); });
  }
  await flush();
};
const col = (label) => screen.getByText(label, { selector: ".kanban-col-head .label" }).closest(".kanban-col");
const count = (label) => col(label).querySelector(".kanban-col-head .count").textContent;
const services = () => ha.calls.map((c) => c.service);
const summaries = (id) => ha.lists[id].map((i) => i.summary);
/* A change made on another device: the list changes, then its entity does. */
const elsewhere = (id, change) => act(() => { change(ha.lists[id]); touch(id); });
async function moveTo(cardName, fromLabel, toLabel) {
  fireEvent.click(within(col(fromLabel)).getByRole("button", { name: `Move ${cardName}` }));
  fireEvent.click(within(col(fromLabel)).getByRole("button", { name: toLabel }));
  await flush();
}

async function mount() {
  const r = render(<KanbanBoardCard />);
  await flush();
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  conn.status = "ready";
  conn.listeners.clear();
  ha.lists = { "todo.backlog": [item("a", "Card A")], "todo.next": [item("n", "Order filament")], "todo.doing_2": [] };
  ha.calls = [];
  ha.reads = 0;
  ha.readLog = [];
  ha.seq = 0;
  ha.clock = 0;
  ha.updated = { "todo.backlog": "t0", "todo.next": "t0", "todo.doing_2": "t0" };
  ha.listeners.clear();
  ha.logged = [];
  ha.rtt = 0;
});
afterEach(() => vi.useRealTimers());

describe("lifecycle#2: a change made elsewhere reaches the board", () => {
  it("a task added on another device shows up a second after its list's entity moves", async () => {
    await mount();
    expect(ha.reads).toBe(ONE_READ);
    expect(count("Backlog")).toBe("1");
    expect(screen.getByText("Kanban · 2 items")).toBeInTheDocument();
    elsewhere("todo.backlog", (l) => l.push(item("b", "Card B")));
    await advance(900);
    expect(ha.reads).toBe(ONE_READ);              // debounced: not straight away
    await advance(100);
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(within(col("Backlog")).getByText("Card B")).toBeInTheDocument();
    expect(count("Backlog")).toBe("2");
    expect(screen.getByText("Kanban · 3 items")).toBeInTheDocument();
  });

  it("a task completed or deleted on another device leaves the board the same way", async () => {
    await mount();
    elsewhere("todo.next", (l) => { l[0].status = "completed"; });
    elsewhere("todo.backlog", (l) => l.splice(0, 1));
    await advance(1000);
    expect(within(col("Done")).getByText("Order filament")).toBeInTheDocument();
    expect(within(col("Next")).queryByText("Order filament")).toBeNull();
    expect(screen.queryByText("Card A")).toBeNull();
    expect(count("Backlog")).toBe("0");
    expect(count("Done")).toBe("1");
  });

  it("a burst of changes is one read, a second after the last of them — never a storm", async () => {
    await mount();
    elsewhere("todo.backlog", (l) => l.push(item("b", "Card B")));
    await advance(400);
    elsewhere("todo.next", (l) => l.push(item("m", "Card M")));
    await advance(400);
    elsewhere("todo.backlog", (l) => l.push(item("c", "Card C")));
    await advance(900);
    expect(ha.reads).toBe(ONE_READ);
    await advance(100);
    expect(ha.reads).toBe(2 * ONE_READ);
    await advance(30_000);
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(count("Backlog")).toBe("3");
    expect(count("Next")).toBe("2");
  });

  it("a count that goes up and back down before the board renders is still a change", async () => {
    await mount();
    act(() => {
      ha.lists["todo.backlog"].push(item("b", "Card B"));
      touch("todo.backlog");
      ha.lists["todo.backlog"].splice(0, 1);           // Card A deleted: the count is 1 again
      touch("todo.backlog");
    });
    await advance(1000);
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(within(col("Backlog")).getByText("Card B")).toBeInTheDocument();
    expect(screen.queryByText("Card A")).toBeNull();
  });

  it("the board's own add reads once, not twice", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Backlog" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task summary" }), { target: { value: "Fix the gate" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await flush();
    await advance(5000);
    expect(ha.reads).toBe(2 * ONE_READ);          // mount + the add's own re-read
    expect(count("Backlog")).toBe("2");
  });

  it("the board's own move and delete read once each, not twice", async () => {
    await mount();
    await moveTo("Card A", "Backlog", "Next");
    await advance(5000);
    // mount, the source check, addConfirmed's two reads of the target, the move's re-read
    expect(ha.reads).toBe(ONE_READ + 1 + 2 + ONE_READ);
    const before = ha.reads;
    fireEvent.click(within(col("Next")).getByRole("button", { name: "Delete Order filament" }));
    await advance(5000 + 5000);                   // the undo window, then the delete and its re-read
    expect(services()).toEqual(["add_item", "remove_item", "remove_item"]);
    expect(ha.reads).toBe(before + ONE_READ);
  });

  it("reads nothing while the socket is down, and a reconnect reads once", async () => {
    await mount();
    act(() => setConn("disconnected"));
    elsewhere("todo.backlog", (l) => l.push(item("b", "Card B")));
    await advance(15 * MIN);
    expect(ha.reads).toBe(ONE_READ);
    act(() => setConn("ready"));
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(within(col("Backlog")).getByText("Card B")).toBeInTheDocument();
    await advance(10_000);
    expect(ha.reads).toBe(2 * ONE_READ);
  });

  it("stops its timers on unmount", async () => {
    const { unmount } = await mount();
    elsewhere("todo.backlog", (l) => l.push(item("b", "Card B")));
    unmount();
    await advance(10 * MIN);
    expect(ha.reads).toBe(ONE_READ);
  });
});

describe("lifecycle#2: a heartbeat for the changes that don't move the entity", () => {
  it("a rename elsewhere shows up within 5 minutes, and the heartbeat keeps going", async () => {
    await mount();
    act(() => { ha.lists["todo.backlog"][0].summary = "Card A, renamed"; });   // no touch(): HA's state didn't move
    await advance(5 * MIN - 1000);
    expect(ha.reads).toBe(ONE_READ);
    expect(screen.getByText("Card A")).toBeInTheDocument();
    await advance(1000);
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(screen.getByText("Card A, renamed")).toBeInTheDocument();
    await advance(5 * MIN);
    expect(ha.reads).toBe(3 * ONE_READ);
  });

  it("counts from the last read, so it never lands on top of another one", async () => {
    await mount();
    await advance(2 * MIN);
    elsewhere("todo.backlog", (l) => l.push(item("b", "Card B")));
    await advance(1000);                          // the change's read, at 2:01
    expect(ha.reads).toBe(2 * ONE_READ);
    await advance(3 * MIN);                       // 5:01 — the mount's heartbeat would have been due at 5:00
    expect(ha.reads).toBe(2 * ONE_READ);
    await advance(2 * MIN);                       // 7:01
    expect(ha.reads).toBe(3 * ONE_READ);
  });

  it("no heartbeat while the socket is down", async () => {
    await mount();
    act(() => setConn("disconnected"));
    await advance(20 * MIN);
    expect(ha.reads).toBe(ONE_READ);
  });
});

describe("lifecycle#2: a stale card can't bring back a task changed elsewhere", () => {
  it("moving a card whose task was deleted elsewhere writes nothing, and the board drops it", async () => {
    await mount();
    elsewhere("todo.backlog", (l) => l.splice(0, 1));   // the board hasn't re-read yet
    await moveTo("Card A", "Backlog", "Next");
    expect(ha.calls).toEqual([]);                 // no add_item: nothing re-created
    expect(summaries("todo.next")).toEqual(["Order filament"]);
    expect(ha.logged).toHaveLength(1);
    expect(ha.logged[0].message).toBe("Kanban move didn't go through");
    expect(ha.logged[0].detail).toMatch(/changed or deleted elsewhere/);
    expect(screen.queryByText("Card A")).toBeNull();   // the re-read shows it gone
    expect(count("Backlog")).toBe("0");
    expect(count("Next")).toBe("1");
  });

  it("a task completed elsewhere isn't re-opened in the target list", async () => {
    await mount();
    elsewhere("todo.backlog", (l) => { l[0].status = "completed"; });
    await moveTo("Card A", "Backlog", "In Progress");
    expect(ha.calls).toEqual([]);
    expect(summaries("todo.doing_2")).toEqual([]);
    expect(within(col("Done")).getByText("Card A")).toBeInTheDocument();
  });

  it("checks the source list by uid, in the state its column shows, before the add", async () => {
    await mount();
    ha.readLog = [];
    await moveTo("Card A", "Backlog", "Next");
    expect(ha.readLog[0]).toBe("todo.backlog:needs_action");
    expect(ha.calls).toEqual([
      { service: "add_item", entity_id: "todo.next", item: "Card A" },
      { service: "remove_item", entity_id: "todo.backlog", item: "a" },
    ]);
  });

  it("a card just moved to Done can go on to another list before the re-read", async () => {
    // Its cached status still says needs_action; the check must go by Done.
    await mount();
    await moveTo("Card A", "Backlog", "Done");
    await moveTo("Card A", "Done", "Next");
    expect(services()).toEqual(["update_item", "add_item", "remove_item"]);
    expect(summaries("todo.next")).toEqual(["Order filament", "Card A"]);
    expect(summaries("todo.backlog")).toEqual([]);
  });
});

/* Round 4b (C1). A cross-list move is five round trips — the source check, the
   target read, add_item, the target read again, remove_item — and its add_item
   moves the target list's entity part-way through. That armed the change read,
   which on a slow link fired mid-move: past ~0.5 s a round trip it was a
   second read on top of the move's own re-read, and past ~1 s it landed
   between the add and the remove, so the task was drawn in Backlog AND Next
   until the move's re-read came (and the ghost copy could be moved again). A
   heartbeat falling due mid-write did the same. Automatic reads now wait for
   the board's own writes. */
describe("round 4b: an automatic read waits for the board's own write", () => {
  const RTT = 1200;
  const inBoth = () => Boolean(within(col("Backlog")).queryByText("Card A") && within(col("Next")).queryByText("Card A"));
  /* 100 ms at a time, looking at the board after every step. */
  async function watch(ms) {
    let doubled = false;
    for (let t = 0; t < ms; t += 100) {
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      await flush();
      doubled ||= inBoth();
    }
    return doubled;
  }
  /* Mounts over a slow link and lets the first read land. The heartbeat is
     then due 5 minutes from now. */
  async function mountSlow(rtt) {
    ha.rtt = rtt;
    await mount();
    await advance(rtt);
    expect(ha.reads).toBe(ONE_READ);
    expect(count("Backlog")).toBe("1");
  }

  it.each([300, 600, 800, 1200, 2000])("a move over a %i ms round trip is never in two columns, and reads once", async (rtt) => {
    await mountSlow(rtt);
    await moveTo("Card A", "Backlog", "Next");
    expect(await watch(6 * rtt + 2000)).toBe(false);
    // mount, the source check, addConfirmed's two reads of the target, the move's re-read
    expect(ha.reads).toBe(ONE_READ + 1 + 2 + ONE_READ);
    expect(ha.logged).toEqual([]);
    expect(summaries("todo.backlog")).toEqual([]);
    expect(summaries("todo.next")).toEqual(["Order filament", "Card A"]);
    expect(within(col("Next")).getByText("Card A")).toBeInTheDocument();
    expect(within(col("Backlog")).queryByText("Card A")).toBeNull();
  });

  it("a heartbeat that falls due mid-move waits too, and isn't lost", async () => {
    await mountSlow(RTT);
    /* Start the move so the heartbeat falls after the add has landed in Home
       Assistant and before the remove has: 2.75 round trips in. */
    await advance(5 * MIN - 2.75 * RTT);
    await moveTo("Card A", "Backlog", "Next");
    expect(await watch(6 * RTT + 2000)).toBe(false);
    expect(ha.reads).toBe(ONE_READ + 1 + 2 + ONE_READ);
    expect(within(col("Backlog")).queryByText("Card A")).toBeNull();
    await advance(5 * MIN);                       // 5 min after the move's re-read, as ever
    expect(ha.reads).toBe(2 * ONE_READ + 1 + 2 + ONE_READ);
  });

  it("a heartbeat that falls due while a delete is being sent waits for it", async () => {
    await mountSlow(RTT);
    // The delete goes out when the 5 s undo window ends; the heartbeat is due 300 ms later.
    await advance(5 * MIN - 5000 - 300);
    fireEvent.click(within(col("Next")).getByRole("button", { name: "Delete Order filament" }));
    await advance(10_000);
    expect(services()).toEqual(["remove_item"]);
    expect(ha.reads).toBe(2 * ONE_READ);          // mount + the delete's own re-read
    expect(screen.queryByText("Order filament")).toBeNull();
  });

  it("a heartbeat that falls due while an add is being sent waits for it", async () => {
    await mountSlow(RTT);
    await advance(5 * MIN - 300);
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Backlog" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task summary" }), { target: { value: "Fix the gate" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await advance(10_000);
    expect(services()).toEqual(["add_item"]);
    expect(ha.reads).toBe(2 * ONE_READ);          // mount + the add's own re-read
    expect(count("Backlog")).toBe("2");
  });

  it("a write that fails lifts the fence: the waiting read still happens", async () => {
    await mountSlow(RTT);
    await advance(5 * MIN - 5000 - 300);
    fireEvent.click(within(col("Next")).getByRole("button", { name: "Delete Order filament" }));
    // Gone elsewhere, without the entity moving, so the delete is refused.
    act(() => { ha.lists["todo.next"].splice(0, 1); });
    await advance(10_000);
    expect(services()).toEqual(["remove_item"]);
    expect(ha.reads).toBe(2 * ONE_READ);          // the heartbeat, a second late
    expect(screen.queryByText("Order filament")).toBeNull();
    expect(count("Next")).toBe("0");
  });
});

describe("listStamp / listsMoved", () => {
  const e = (state, lu) => ({ state, last_updated: lu });
  it("stamps state and last_updated, and nothing for a missing entity", () => {
    expect(listStamp(e("2", "t1"))).toBe("2@t1");
    expect(listStamp(undefined)).toBe("");
  });

  it("is a change only for a list it had already seen", () => {
    expect(listsMoved("2@t1,0@t1", "3@t2,0@t1")).toBe(true);
    expect(listsMoved("2@t1,0@t1", "2@t2,0@t1")).toBe(true);    // same count, new write
    expect(listsMoved("2@t1,0@t1", "2@t1,0@t1")).toBe(false);
    expect(listsMoved(",", "2@t1,0@t1")).toBe(false);            // first sight: the snapshot
    expect(listsMoved("2@t1,0@t1", ",0@t1")).toBe(false);        // gone: isDeadList's business
    expect(listsMoved(undefined, null)).toBe(false);
  });
});
