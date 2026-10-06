/* The Kanban "+ Add" form on its own: custom tags survive the trip to Home
   Assistant and back, a chosen tag can be removed with a real button, and
   the draft stays put until the board says the add landed. */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { KanbanAddForm } from "../../src/cards/schedule/KanbanAddForm.jsx";
import { parseTags, buildDescription } from "../../src/cards/schedule/kanbanUtils.js";

function setup(onSubmit = vi.fn(() => Promise.resolve())) {
  render(<KanbanAddForm onSubmit={onSubmit} onCancel={() => {}} />);
  return onSubmit;
}
const flush = () => act(() => Promise.resolve());

function addCustomTag(text) {
  if (!screen.queryByRole("textbox", { name: "Custom tag" })) {
    fireEvent.click(screen.getByRole("button", { name: /Choose tags$/ }));
  }
  const input = screen.getByRole("textbox", { name: "Custom tag" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

async function submit(summary) {
  fireEvent.change(screen.getByRole("textbox", { name: "Task summary" }), { target: { value: summary } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await flush();
}

describe("custom tags", () => {
  it("stores what the board can read back, whatever was typed", async () => {
    const onSubmit = setup();
    for (const raw of ["urgent ", " later", "café", "q&a"]) addCustomTag(raw);
    await submit("Sort the shed");
    const [, tags] = onSubmit.mock.calls[0];
    expect(tags).toEqual(["urgent", "later", "café", "qa"]);
    // What HA will hold for those tags parses back to the same chips.
    expect(parseTags(buildDescription(tags, "")).tags).toEqual(tags);
  });

  it("ignores a tag that is nothing but spaces and punctuation", async () => {
    const onSubmit = setup();
    addCustomTag("  -- ");
    await submit("Sort the shed");
    expect(onSubmit.mock.calls[0][1]).toEqual([]);
  });

  it("removes a chosen tag with a real, labelled button, and keeps focus in the form", async () => {
    const onSubmit = setup();
    addCustomTag("garden");
    const rm = screen.getByRole("button", { name: "Remove tag garden" });
    expect(rm.tagName).toBe("BUTTON");
    rm.focus();
    fireEvent.click(rm);
    expect(screen.queryByRole("button", { name: "Remove tag garden" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Choose tags" }));
    await submit("Sort the shed");
    expect(onSubmit.mock.calls[0][1]).toEqual([]);
  });
});

describe("submitting", () => {
  it("shows it is busy and can't be sent twice while Home Assistant is answering", async () => {
    let resolve;
    const onSubmit = setup(vi.fn(() => new Promise((r) => { resolve = r; })));
    await submit("Book MOT");
    const btn = screen.getByRole("button", { name: "Adding…" });
    expect(btn).toBeDisabled();
    fireEvent.submit(btn.closest("form"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
  });

  it("keeps the draft and says so when the add is refused", async () => {
    setup(vi.fn(() => Promise.reject(new Error("Not connected"))));
    addCustomTag("errand");
    await submit("Book MOT");
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn.t add/);
    expect(screen.getByRole("textbox", { name: "Task summary" })).toHaveValue("Book MOT");
    expect(screen.getByRole("button", { name: "Remove tag Errand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).not.toBeDisabled();
  });
});
