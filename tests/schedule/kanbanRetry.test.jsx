/* A Kanban column whose read failed gets read again — the 2026-10 round-3
   review finding M8.

   One failed todo.get_items used to leave a column on "Couldn't read this
   column" until a reconnect or some unrelated add/move/delete happened to
   re-read the board. Now a failed read is retried on a bounded backoff (the
   calendar's 8 s then 20 s, then it stops — no loop at the Pi), there is a
   visible Retry on the column, and a reconnect starts over. A dead list is
   left alone: asking again can't help, and it recovers when it comes back. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { flushSync } from "react-dom";

const conn = { status: "ready", listeners: new Set() };
const ha = {
  lists: {},
  reads: 0,                 // todo.get_items calls, all lists, both statuses
  failOnce: new Set(),      // list ids whose NEXT read fails, then recovers
  failAlways: new Set(),
  dead: new Set(),          // unavailable in HA
  hold: null,               // a promise every read waits on, to catch one in flight
  listeners: new Set(),
};
function setConn(s) {
  conn.status = s;
  conn.listeners.forEach((l) => l(s));
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
      const status = connStatus !== "ready" ? "loading" : ha.dead.has(id) ? "unavailable" : "ready";
      return { entity: { state: status === "ready" ? "0" : "unavailable" }, status };
    },
  };
});

vi.mock("../../src/ha/client.js", () => ({
  getTodoItems: async (id, status) => {
    ha.reads += 1;
    if (ha.hold) await ha.hold;
    if (ha.dead.has(id) || ha.failAlways.has(id)) throw new Error(`todo.get_items: no answer for ${id}`);
    if (ha.failOnce.has(id)) {
      // Both of this read's calls (needs_action + completed) fail; the next read works.
      if (status === "completed") ha.failOnce.delete(id);
      throw new Error(`todo.get_items ${id} failed`);
    }
    return (ha.lists[id] || []).filter((it) => it.status === status).map((it) => ({ ...it }));
  },
  callService: async () => null,
}));

import { KanbanBoardCard } from "../../src/cards/schedule/KanbanBoardCard.jsx";

const ONE_READ = 6; // 3 lists × (needs_action + completed)
const item = (uid, summary, status = "needs_action") => ({ uid, summary, status });
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => {}); };
/* In 1 s steps, each its own act(): React holds a render queued inside act()
   until the act ends, so one long advance would let a retry's timer fire but
   not the re-read it asks for — and the next timer would never be set. */
const advance = async (ms) => {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t)); });
  }
  await flush();
};
const col = (label) => screen.getByText(label, { selector: ".kanban-col-head .label" }).closest(".kanban-col");
const count = (label) => col(label).querySelector(".kanban-col-head .count").textContent;
const retryIn = (label) => within(col(label)).queryByRole("button", { name: new RegExp(`^Retry(ing)? ${label}$`) });

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
  ha.reads = 0;
  ha.failOnce = new Set();
  ha.failAlways = new Set();
  ha.dead = new Set();
  ha.hold = null;
  ha.listeners.clear();
});
afterEach(() => vi.useRealTimers());

describe("M8: a column whose read failed recovers by itself", () => {
  it("a one-off failure is read again on a timer and the column comes back", async () => {
    ha.failOnce.add("todo.next");
    await mount();
    expect(count("Next")).toBe("—");
    expect(within(col("Next")).getByText("Couldn't read this column")).toBeInTheDocument();
    await advance(8000);
    expect(count("Next")).toBe("1");
    expect(within(col("Next")).getByText("Order filament")).toBeInTheDocument();
    expect(within(col("Next")).queryByText(/Couldn't/)).toBeNull();
    expect(retryIn("Next")).toBeNull();
  });

  it("a list that keeps failing is retried twice on a backoff, then left to the 5-minute heartbeat — no loop", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    expect(ha.reads).toBe(ONE_READ);
    await advance(7900);
    expect(ha.reads).toBe(ONE_READ);            // not before 8 s
    await advance(200);
    expect(ha.reads).toBe(2 * ONE_READ);        // retry 1 at 8 s
    await advance(19_800);
    expect(ha.reads).toBe(2 * ONE_READ);        // not before 20 s more
    await advance(300);
    expect(ha.reads).toBe(3 * ONE_READ);        // retry 2, at 28 s
    /* Then the retries stop. What's left is the heartbeat every board gets
       (round 4, kanbanRound4.test.jsx): one read 5 minutes after the last,
       and a heartbeat that fails doesn't start the backoff again. */
    await advance(5 * 60_000 - 1000);
    expect(ha.reads).toBe(3 * ONE_READ);
    await advance(1000);
    expect(ha.reads).toBe(4 * ONE_READ);        // the heartbeat
    await advance(60_000);
    expect(ha.reads).toBe(4 * ONE_READ);        // no 8 s / 20 s retries after it
    expect(within(col("Next")).getByText("Couldn't read this column")).toBeInTheDocument();
  });

  it("a reconnect reads again and earns back the retries", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    await advance(30_000);
    expect(ha.reads).toBe(3 * ONE_READ);
    ha.failAlways.clear();
    ha.failOnce.add("todo.next");               // the first read after the reconnect fails too
    act(() => setConn("disconnected"));
    act(() => setConn("ready"));
    await flush();
    expect(ha.reads).toBe(4 * ONE_READ);
    expect(count("Next")).toBe("—");
    await advance(8000);                        // a fresh budget, so it is retried
    expect(count("Next")).toBe("1");
  });

  it("nothing is retried while the socket is down", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    act(() => setConn("disconnected"));
    await advance(60_000);
    expect(ha.reads).toBe(ONE_READ);
  });

  it("does not retry a dead list — it recovers when HA has it back", async () => {
    ha.dead.add("todo.next");
    await mount();
    await advance(60_000);
    expect(ha.reads).toBe(ONE_READ);
    expect(within(col("Next")).getByText("List unavailable")).toBeInTheDocument();
    expect(retryIn("Next")).toBeNull();
    act(() => { ha.dead.delete("todo.next"); ha.listeners.forEach((l) => l()); });
    await flush();
    expect(count("Next")).toBe("1");
  });

  it("stops its timer on unmount", async () => {
    ha.failAlways.add("todo.next");
    const { unmount } = await mount();
    unmount();
    await advance(60_000);
    expect(ha.reads).toBe(ONE_READ);
  });
});

describe("M8: a failed column has a Retry button", () => {
  it("is offered on the failed column only, and re-reads when pressed", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    const retry = retryIn("Next");
    expect(retry).toBeInTheDocument();
    expect(retry.tagName).toBe("BUTTON");
    expect(retry).toHaveTextContent("Retry");
    expect(retryIn("Backlog")).toBeNull();
    ha.failAlways.clear();
    fireEvent.click(retry);
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(count("Next")).toBe("1");
    expect(retryIn("Next")).toBeNull();
  });

  it("still works after the automatic retries have run out, and earns them back", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    await advance(30_000);
    expect(ha.reads).toBe(3 * ONE_READ);
    fireEvent.click(retryIn("Next"));
    await flush();
    expect(ha.reads).toBe(4 * ONE_READ);
    await advance(8000);
    expect(ha.reads).toBe(5 * ONE_READ);         // the backoff runs again
  });

  it("is offered on a column that still shows cards from before, with the stale caveat", async () => {
    await mount();
    ha.failAlways.add("todo.backlog");
    act(() => setConn("disconnected"));
    act(() => setConn("ready"));
    await flush();
    expect(within(col("Backlog")).getByText("Card A")).toBeInTheDocument();
    expect(within(col("Backlog")).getByText(/Couldn't refresh/)).toBeInTheDocument();
    expect(retryIn("Backlog")).toBeInTheDocument();
  });

  it("a keyboard Retry that works hands focus to its column, not to <body>", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    ha.failAlways.clear();
    const retry = retryIn("Next");
    retry.focus();
    fireEvent.click(retry, { detail: 0 });       // Enter / Space
    await flush();
    expect(retryIn("Next")).toBeNull();
    expect(document.activeElement).toBe(col("Next"));
  });

  it("a tapped Retry doesn't move focus anywhere", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    ha.failAlways.clear();
    const retry = retryIn("Next");
    retry.focus();                                // Chromium focuses a tapped button
    fireEvent.click(retry, { detail: 1 });
    await flush();
    expect(document.activeElement).not.toBe(col("Next"));
  });

  it("says it is retrying while the read is in flight, and a second press doesn't start another", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    ha.failAlways.clear();
    let release;
    ha.hold = new Promise((r) => { release = r; });
    fireEvent.click(retryIn("Next"));
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);         // the retry read has started...
    expect(retryIn("Next")).toHaveTextContent("Retrying…");
    expect(retryIn("Next")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(retryIn("Next"));
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);         // ...and a second press didn't start another
    ha.hold = null;
    await act(async () => { release(); });
    await flush();
    expect(count("Next")).toBe("1");
    expect(retryIn("Next")).toBeNull();
  });
});

/* Round 3b review findings B15, B16 and B18. */
describe("B15: Retry pressed twice starts one read", () => {
  it("a double-click or Enter twice, landing before React re-renders, sends one read, not two", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    ha.failAlways.clear();
    const retry = retryIn("Next");
    /* Two browser events: each press commits on its own (React flushes a
       discrete event's render), but the "reading" re-render the first one
       asks for hasn't happened when the second lands. The old state-only guard
       saw reading=false twice and started two full reads. */
    act(() => {
      flushSync(() => { retry.click(); });
      flushSync(() => { retry.click(); });
    });
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(count("Next")).toBe("1");
    expect(retryIn("Next")).toBeNull();
  });

  it("the guard lets the next press through once the read has settled", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    fireEvent.click(retryIn("Next"));
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);
    fireEvent.click(retryIn("Next"));            // still failing: Retry is back, and works again
    await flush();
    expect(ha.reads).toBe(3 * ONE_READ);
  });
});

describe("B16: keyboard focus isn't dropped when Retry goes away by itself", () => {
  it("a keyboard Retry that fails, then an automatic retry that works: focus goes to the column", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    const retry = retryIn("Next");
    act(() => retry.focus());
    fireEvent.click(retry, { detail: 0 });       // Enter / Space
    await flush();
    expect(ha.reads).toBe(2 * ONE_READ);
    expect(document.activeElement).toBe(retryIn("Next"));   // failed again: focus stays put
    ha.failAlways.clear();
    await advance(8000);
    expect(retryIn("Next")).toBeNull();
    expect(document.activeElement).toBe(col("Next"));
  });

  it("a focused Retry that was never pressed: the timer's success hands focus to the column", async () => {
    ha.failOnce.add("todo.next");
    await mount();
    act(() => retryIn("Next").focus());          // Tabbed to, not pressed
    await advance(8000);
    expect(retryIn("Next")).toBeNull();
    expect(document.activeElement).toBe(col("Next"));
  });

  it("the socket dropping under a focused Retry hands focus to the column, and it stays there", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    act(() => retryIn("Next").focus());
    act(() => setConn("disconnected"));
    expect(retryIn("Next")).toBeNull();
    expect(document.activeElement).toBe(col("Next"));
    act(() => setConn("ready"));
    await flush();
    expect(retryIn("Next")).toBeInTheDocument();  // still failing, so it's offered again
    expect(document.activeElement).toBe(col("Next"));
  });

  it("doesn't take focus from wherever it went in the meantime", async () => {
    ha.failOnce.add("todo.next");
    await mount();
    act(() => retryIn("Next").focus());
    const add = screen.getByRole("button", { name: "Add a task to Backlog" });
    act(() => add.focus());
    await advance(8000);
    expect(retryIn("Next")).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it("a tapped Retry is still left alone when the timer removes it", async () => {
    ha.failAlways.add("todo.next");
    await mount();
    const retry = retryIn("Next");
    act(() => retry.focus());                    // Chromium focuses a tapped button
    fireEvent.click(retry, { detail: 1 });
    await flush();
    ha.failAlways.clear();
    await advance(8000);
    expect(retryIn("Next")).toBeNull();
    expect(document.activeElement).not.toBe(col("Next"));
  });
});

describe("B18: a column that was never read doesn't pass its added cards off as the list", () => {
  async function addTo(label, text) {
    fireEvent.click(screen.getByRole("button", { name: `Add a task to ${label}` }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task summary" }), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await flush();
  }

  it("shows '—', not 1, after adding to a column whose read has never worked", async () => {
    ha.lists["todo.backlog"] = [item("a", "Card A"), item("b", "Card B")];   // the list really holds 2
    ha.failAlways.add("todo.backlog");
    await mount();
    expect(count("Backlog")).toBe("—");
    await addTo("Backlog", "Fix the gate");
    expect(within(col("Backlog")).getByText("Fix the gate")).toBeInTheDocument();
    expect(count("Backlog")).toBe("—");
    expect(within(col("Backlog")).getByText("Couldn't read all of this column")).toBeInTheDocument();
    expect(retryIn("Backlog")).toBeInTheDocument();
    expect(screen.queryByText(/Kanban · \d+ items/)).toBeNull();
    await advance(1000);                          // the add's own re-read fails as well
    expect(count("Backlog")).toBe("—");
    ha.failAlways.clear();
    fireEvent.click(retryIn("Backlog"));
    await flush();
    expect(count("Backlog")).toBe("2");           // what the list holds, once it has been read
  });

  it("a column that was read before still shows its count, with the stale caveat", async () => {
    await mount();
    expect(count("Backlog")).toBe("1");
    ha.failAlways.add("todo.backlog");
    act(() => setConn("disconnected"));
    act(() => setConn("ready"));
    await flush();
    await addTo("Backlog", "Fix the gate");
    expect(count("Backlog")).toBe("2");
    expect(within(col("Backlog")).getByText(/Couldn't refresh · may be out of date/)).toBeInTheDocument();
  });
});
