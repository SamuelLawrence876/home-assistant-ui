/* Round 4c re-review of the Kanban board's reads (R4C-2, R4C-3, R4C-6).

   R4C-2: round 4b fenced automatic reads off while the board's own write was
   in flight, but a write's own re-read still ran whatever else was in flight —
   two overlapping moves, and the first one's re-read caught the second between
   its add and its remove: the task drawn in two columns. And a read already in
   flight when a write started was drawn on landing, over the write's
   optimistic change.

   R4C-6: nothing bounded the fence or a read. A call HA accepted and never
   answered, over a socket that stayed up, stopped every automatic read for
   good (fence), or left Retry and the heartbeat dead (read).

   R4C-3: a list HA was still loading on a reconnect failed the reconnect's
   read, then arrived as "first sight", which isn't a change — so once the two
   retries were spent its column waited for the 5-minute heartbeat.

   The fake is kanbanRound4.test.jsx's — local_todo on the points that matter,
   with an optional round trip — plus lists HA hasn't sent yet (`held`), lists
   it can't read yet (`failing`), and calls and reads that never answer. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const conn = { status: "ready", listeners: new Set() };
const ha = {
  lists: {}, calls: [], reads: 0, seq: 0, clock: 0, updated: {}, listeners: new Set(), logged: [], rtt: 0,
  held: new Set(),        // HA hasn't sent this list on this connection: no entity, "loading"
  failing: new Set(),     // get_items for this list fails (local_todo not loaded yet)
  hangCalls: new Set(),   // services that HA accepts and never answers
  hangReads: new Set(),   // lists whose get_items HA never answers
  callsInFlight: 0,
  boardReadsMidCall: 0,   // board reads that started while a service call was in flight
};
const halfTrip = () => (ha.rtt ? new Promise((r) => { setTimeout(r, ha.rtt / 2); }) : null);
const never = () => new Promise(() => {});
function setConn(s) {
  conn.status = s;
  conn.listeners.forEach((l) => l(s));
}
const openCount = (id) => (ha.lists[id] || []).filter((it) => it.status === "needs_action").length;
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
    // Only the board's own read asks for completed items here: no test moves out of Done.
    if (status === "completed" && id === "todo.backlog" && ha.callsInFlight > 0) ha.boardReadsMidCall += 1;
    if (ha.hangReads.has(id)) return never();
    if (ha.rtt) await halfTrip();
    if (ha.failing.has(id)) throw new Error(`todo.get_items: ${id} not loaded`);
    const items = (ha.lists[id] || []).filter((it) => it.status === status).map((it) => ({ ...it }));
    if (ha.rtt) await halfTrip();
    return items;
  },
  callService: async (domain, service, data) => {
    ha.calls.push({ service, ...data });
    if (ha.hangCalls.has(service)) return never();
    ha.callsInFlight += 1;
    try {
      if (ha.rtt) await halfTrip();
      const list = ha.lists[data.entity_id] || (ha.lists[data.entity_id] = []);
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
    } finally {
      ha.callsInFlight -= 1;
    }
    touch(data.entity_id);
    return null;
  },
}));

vi.mock("../../src/lib/errorLog.js", () => ({ logError: (entry) => { ha.logged.push(entry); } }));

import { KanbanBoardCard } from "../../src/cards/schedule/KanbanBoardCard.jsx";
import { listsBack, withTimeout } from "../../src/cards/schedule/kanbanUtils.js";

const ONE_READ = 6; // 3 lists × (needs_action + completed)
const MIN = 60_000;
const item = (uid, summary, status = "needs_action") => ({ uid, summary, status });
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => {}); };
const advance = async (ms) => {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t)); });
  }
  await flush();
};
const LABELS = ["Backlog", "Next", "In Progress", "Done"];
const col = (label) => screen.getByText(label, { selector: ".kanban-col-head .label" }).closest(".kanban-col");
const count = (label) => col(label).querySelector(".kanban-col-head .count").textContent;
const services = () => ha.calls.map((c) => c.service);
const summaries = (id) => ha.lists[id].map((i) => i.summary);
const elsewhere = (id, change) => act(() => { change(ha.lists[id]); touch(id); });
const retryIn = (label) => within(col(label)).queryByRole("button", { name: new RegExp(`^Retry(ing)? ${label}$`) });
/* Every card summary drawn in more than one column. */
function doubled() {
  const seen = new Map();
  for (const label of LABELS) {
    for (const el of col(label).querySelectorAll("[data-kanban-key]")) {
      const name = el.querySelector(".summary")?.textContent;
      seen.set(name, (seen.get(name) || 0) + 1);
    }
  }
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name);
}
const inCol = (label, name) => Boolean(within(col(label)).queryByText(name));
/* 100 ms at a time, calling `look` after every step. */
async function watch(ms, look) {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await flush();
    look();
  }
}
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
async function mountSlow(rtt) {
  ha.rtt = rtt;
  await mount();
  await advance(rtt);
  expect(ha.reads).toBe(ONE_READ);
}

beforeEach(() => {
  vi.useFakeTimers();
  conn.status = "ready";
  conn.listeners.clear();
  ha.lists = { "todo.backlog": [item("a", "Card A"), item("b", "Card B")], "todo.next": [item("n", "Order filament")], "todo.doing_2": [] };
  ha.calls = [];
  ha.reads = 0;
  ha.seq = 0;
  ha.clock = 0;
  ha.updated = { "todo.backlog": "t0", "todo.next": "t0", "todo.doing_2": "t0" };
  ha.listeners.clear();
  ha.logged = [];
  ha.rtt = 0;
  ha.held = new Set();
  ha.failing = new Set();
  ha.hangCalls = new Set();
  ha.hangReads = new Set();
  ha.callsInFlight = 0;
  ha.boardReadsMidCall = 0;
});
afterEach(() => vi.useRealTimers());

describe("R4C-2: a read never lands across the board's own writes", () => {
  /* Move B starts two round trips into move A. A's re-read used to start 500 ms
     after A ended — while B had added its task to In Progress and not yet
     removed it from Backlog — so the board drew Card B in both columns until
     B's own re-read came. */
  it.each([600, 800, 1200, 2000])("two overlapping moves over a %i ms round trip: never in two columns, one re-read for both", async (rtt) => {
    await mountSlow(rtt);
    const twice = new Set();
    const look = () => doubled().forEach((n) => twice.add(n));
    await moveTo("Card A", "Backlog", "Next");
    await watch(2 * rtt, look);
    await moveTo("Card B", "Backlog", "In Progress");
    await watch(8 * rtt + 3000, look);
    expect([...twice]).toEqual([]);
    // mount, each move's source check + addConfirmed's two reads, ONE re-read after both
    expect(ha.reads).toBe(ONE_READ + 3 + 3 + ONE_READ);
    expect(ha.logged).toEqual([]);
    expect(summaries("todo.backlog")).toEqual([]);
    expect(summaries("todo.next")).toEqual(["Order filament", "Card A"]);
    expect(summaries("todo.doing_2")).toEqual(["Card B"]);
    expect(inCol("Next", "Card A") && inCol("In Progress", "Card B")).toBe(true);
    expect(inCol("Backlog", "Card A") || inCol("Backlog", "Card B")).toBe(false);
    await advance(10_000);
    expect(ha.reads).toBe(ONE_READ + 3 + 3 + ONE_READ);   // nothing left owed
  });

  it("a read already in flight when a move starts doesn't put the card back", async () => {
    const RTT = 1200;
    await mountSlow(RTT);
    // Changed elsewhere: the board reads again a second later, and takes a round trip.
    elsewhere("todo.doing_2", (l) => l.push(item("x", "Card X")));
    await advance(1000);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(ha.reads).toBe(2 * ONE_READ);          // in flight, from before the move
    let back = false;
    await moveTo("Card A", "Backlog", "Next");
    await watch(6 * RTT + 2000, () => { back ||= inCol("Backlog", "Card A"); });
    expect(back).toBe(false);
    expect(doubled()).toEqual([]);
    expect(ha.reads).toBe(2 * ONE_READ + 3 + ONE_READ);    // the dropped read is covered by the move's
    expect(inCol("Next", "Card A")).toBe(true);
    expect(inCol("In Progress", "Card X")).toBe(true);    // what the dropped read had, read again
  });

  it("a failed write that ends while another write's re-read is owed does that read — after both", async () => {
    const RTT = 1200;
    await mountSlow(RTT);
    /* The delete goes out (at the end of its 5 s undo window) 5.2 round trips
       after the move starts, and is refused half a round trip later: in flight
       when the move ends, 5 round trips + 500 ms in. The move's re-read used to
       start right then, on top of the delete. */
    await moveTo("Card A", "Backlog", "Next");
    await advance(Math.round(5.2 * RTT) - 5000);
    fireEvent.click(within(col("Next")).getByRole("button", { name: "Delete Order filament" }));
    act(() => { ha.lists["todo.next"].splice(0, 1); });   // gone elsewhere, entity unmoved
    await watch(5000 + 3 * RTT, () => {});         // in 100 ms steps, so a read starts when it is asked for
    expect(services()).toEqual(["add_item", "remove_item", "remove_item"]);
    expect(ha.logged).toEqual([]);                // the move went through
    expect(ha.boardReadsMidCall).toBe(0);         // its re-read waited for the delete...
    expect(ha.reads).toBe(ONE_READ + 3 + ONE_READ);   // ...and still happened, once
    expect(count("Next")).toBe("1");
    expect(inCol("Next", "Card A")).toBe(true);
    expect(screen.queryByText("Order filament")).toBeNull();
  });
});

describe("R4C-6: something that never answers can't stop the board reading", () => {
  it("a write HA never answers holds automatic reads back for 30 s, not for good", async () => {
    await mount();
    ha.hangCalls.add("remove_item");
    fireEvent.click(within(col("Next")).getByRole("button", { name: "Delete Order filament" }));
    await advance(5000);                          // the undo window: remove_item is sent, and hangs
    expect(services()).toEqual(["remove_item"]);
    elsewhere("todo.backlog", (l) => l.push(item("c", "Card C")));
    await advance(28_000);
    expect(ha.reads).toBe(ONE_READ);              // still waiting on the write
    await advance(3000);
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(inCol("Backlog", "Card C")).toBe(true);
    await advance(5 * MIN);
    expect(ha.reads).toBe(3 * ONE_READ);          // and the heartbeat carries on
  });

  /* A move that fails ends owing a re-read (half of it may have landed), but a
     delete HA never answers is still in flight then. Nothing moves the lists'
     entities — the move's first read failed, and a rename moves no entity — so
     no change read is coming either: the owed read used to wait for the
     5-minute heartbeat. */
  it("a read owed while a write HA never answers is in flight comes when the fence's 30 s bound lifts", async () => {
    await mount();
    ha.hangCalls.add("remove_item");
    fireEvent.click(within(col("Next")).getByRole("button", { name: "Delete Order filament" }));
    await advance(5000);                          // remove_item is sent, and hangs
    expect(services()).toEqual(["remove_item"]);
    ha.failing.add("todo.backlog");               // the move's source check can't read Backlog
    await moveTo("Card A", "Backlog", "In Progress");
    ha.failing.delete("todo.backlog");
    expect(ha.logged.map((e) => e.message)).toEqual(["Kanban move didn't go through"]);
    expect(ha.reads).toBe(ONE_READ + 1);
    act(() => { ha.lists["todo.backlog"][1].summary = "Card B, renamed"; });   // elsewhere
    await advance(28_000);
    expect(ha.reads).toBe(ONE_READ + 1);          // still held back by the delete
    await advance(3000);
    expect(ha.reads).toBe(2 * ONE_READ + 1);      // the delete is 30 s old: the owed read
    expect(inCol("Backlog", "Card B, renamed")).toBe(true);
    expect(inCol("Backlog", "Card A")).toBe(true);
    await advance(60_000);
    expect(ha.reads).toBe(2 * ONE_READ + 1);      // once
  });

  it("a read HA never answers settles as failed after 30 s: the column says so, and Retry and the retries work", async () => {
    await mount();
    ha.hangReads.add("todo.next");
    elsewhere("todo.backlog", (l) => l.push(item("c", "Card C")));
    await advance(1000);
    expect(ha.reads).toBe(2 * ONE_READ);          // sent; Next's half never answers
    await advance(28_000);
    expect(within(col("Next")).queryByText(/Couldn't/)).toBeNull();
    await advance(2000);
    expect(inCol("Backlog", "Card C")).toBe(true);          // the lists that did answer
    expect(within(col("Next")).getByText("Couldn't refresh · may be out of date")).toBeInTheDocument();
    expect(retryIn("Next")).toHaveTextContent(/^Retry$/);
    ha.hangReads.clear();
    fireEvent.click(retryIn("Next"));
    await flush();
    expect(ha.reads).toBe(3 * ONE_READ);
    expect(within(col("Next")).queryByText(/Couldn't/)).toBeNull();
  });

  it("after a read that timed out, the automatic retry still comes", async () => {
    await mount();
    ha.hangReads.add("todo.next");
    elsewhere("todo.backlog", (l) => l.push(item("c", "Card C")));
    await advance(31_000);
    ha.hangReads.clear();
    await advance(8000);
    expect(ha.reads).toBe(3 * ONE_READ);
    expect(within(col("Next")).queryByText(/Couldn't/)).toBeNull();
  });
});

describe("R4C-3: a list HA was still loading on a reconnect is read when it arrives", () => {
  async function reconnectWithNextLoading({ readable }) {
    await mount();
    act(() => setConn("disconnected"));
    ha.held.add("todo.next");
    if (!readable) ha.failing.add("todo.next");
    act(() => setConn("ready"));
    await flush();
  }
  const arrive = () => act(() => {
    ha.held.delete("todo.next");
    ha.failing.delete("todo.next");
    ha.listeners.forEach((l) => l());
  });

  it("after the retries are spent, its arrival reads it — once", async () => {
    await reconnectWithNextLoading({ readable: false });
    // Still loading in HA, so a wait rather than a failure (D5/D21, kanbanRound4d.test.jsx).
    expect(within(col("Next")).getByText("Loading… · may be out of date")).toBeInTheDocument();
    await advance(28_000 + 60_000);               // both retries fail; then nothing until the heartbeat
    expect(ha.reads).toBe(4 * ONE_READ);          // mount, reconnect, two retries
    act(() => { ha.lists["todo.next"].push(item("m", "Card M")); });   // added while HA was loading
    await arrive();
    await advance(1000);
    expect(ha.reads).toBe(5 * ONE_READ);
    expect(within(col("Next")).queryByText(/Couldn't/)).toBeNull();
    expect(inCol("Next", "Card M")).toBe(true);
    await advance(60_000);
    expect(ha.reads).toBe(5 * ONE_READ);
  });

  it("a list that arrives after a clean read isn't read again", async () => {
    await reconnectWithNextLoading({ readable: true });
    expect(ha.reads).toBe(2 * ONE_READ);
    await arrive();
    await advance(60_000);
    expect(ha.reads).toBe(2 * ONE_READ);
  });

  it("nothing is read for it while the socket is still down", async () => {
    await reconnectWithNextLoading({ readable: false });
    await advance(28_000);
    act(() => setConn("disconnected"));
    await arrive();
    await advance(60_000);
    expect(ha.reads).toBe(4 * ONE_READ);
  });
});

describe("listsBack / withTimeout", () => {
  it("names a list that has just turned ready and whose last read failed", () => {
    const failed = new Set(["todo.next"]);
    expect(listsBack("todo.backlog", "todo.backlog,todo.next", failed)).toEqual(["todo.next"]);
    expect(listsBack("todo.backlog,todo.next", "todo.backlog,todo.next", failed)).toEqual([]);   // already ready
    expect(listsBack("", "todo.backlog", failed)).toEqual([]);                                   // read fine last time
    expect(listsBack("todo.next", "", failed)).toEqual([]);                                      // going, not coming
  });

  it("rejects a promise that doesn't settle in time, and passes one that does", async () => {
    const late = withTimeout(new Promise(() => {}), 30_000);
    const caught = late.catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await caught).toMatch(/no answer in 30 s/);
    await expect(withTimeout(Promise.resolve(3), 30_000)).resolves.toBe(3);
    await expect(withTimeout(Promise.reject(new Error("no")), 30_000)).rejects.toThrow("no");
  });
});
