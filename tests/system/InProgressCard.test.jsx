/* "Doing now" is the Kanban In Progress column. It used to ask todo.get_items
   with no status — which HA answers with completed items too — so every card
   dragged to Done kept showing here. A failed fetch silently left the old
   list on screen as if it were current. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const fixtures = { entities: {} };
const getTodoItems = vi.fn();

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => fixtures.entities[id] ?? { entity: null, status: "loading" },
}));
vi.mock("../../src/ha/client.js", () => ({
  getTodoItems: (...args) => getTodoItems(...args),
}));

import { InProgressCard } from "../../src/cards/system/InProgressCard.jsx";

const list = (state) => ({ "todo.doing_2": { entity: { state, attributes: {} }, status: "ready" } });
const flush = () => act(() => Promise.resolve());

function deferred() {
  let resolve;
  const promise = new Promise((res) => (resolve = res));
  return { promise, resolve };
}

beforeEach(() => {
  getTodoItems.mockReset();
});

describe("InProgressCard", () => {
  it("asks for open items only", async () => {
    fixtures.entities = list("2");
    getTodoItems.mockResolvedValue([{ summary: "open A" }, { summary: "open B" }]);
    render(<InProgressCard />);
    await flush();
    expect(getTodoItems).toHaveBeenCalledWith("todo.doing_2", "needs_action");
    expect(screen.getByText("open A")).toBeTruthy();
    expect(screen.getByText("In Progress · 2 items")).toBeTruthy();
  });

  it("says it couldn't read the list instead of keeping the old one", async () => {
    fixtures.entities = list("2");
    getTodoItems.mockResolvedValueOnce([{ summary: "open A" }]);
    const { rerender } = render(<InProgressCard />);
    await flush();
    expect(screen.getByText("open A")).toBeTruthy();

    getTodoItems.mockRejectedValueOnce(new Error("timeout"));
    fixtures.entities = list("3");
    rerender(<InProgressCard />);
    await flush();
    expect(screen.queryByText("open A")).toBeNull();
    expect(screen.getByText("Couldn’t read this list.")).toBeTruthy();
  });

  it("tells an empty list apart from an unreadable one", async () => {
    fixtures.entities = list("0");
    getTodoItems.mockResolvedValue([]);
    render(<InProgressCard />);
    await flush();
    expect(screen.getByText("Nothing in progress.")).toBeTruthy();
  });

  it("ignores a slower, older response", async () => {
    const older = deferred();
    fixtures.entities = list("1");
    getTodoItems.mockReturnValueOnce(older.promise).mockResolvedValueOnce([{ summary: "new" }]);
    const { rerender } = render(<InProgressCard />);
    fixtures.entities = list("2");
    rerender(<InProgressCard />);
    await flush();
    await act(async () => {
      older.resolve([{ summary: "old" }]);
      await older.promise;
    });
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.queryByText("old")).toBeNull();
  });

  it("does not fetch, or claim the list is empty, when the list is unavailable", async () => {
    fixtures.entities = { "todo.doing_2": { entity: { state: "unavailable", attributes: {} }, status: "unavailable" } };
    render(<InProgressCard />);
    await flush();
    expect(getTodoItems).not.toHaveBeenCalled();
    expect(screen.queryByText("Nothing in progress.")).toBeNull();
    expect(screen.getByText("Couldn’t read this list.")).toBeTruthy();
  });
});
