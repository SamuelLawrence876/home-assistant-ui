/* Presence on Overview. "We don't know where he is" and "he is out" are
   different facts: a person.* entity that reads "unknown" (no tracker has
   reported) or is missing must not render the same Away pill as a real
   not_home. EntityGuard renders the body behind its warning badge in those
   states, so the card itself has to say Unknown. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fixture = { current: { entity: null, status: "loading" } };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => fixture.current,
}));

const { PresenceCard } = await import("../../src/cards/overview/PresenceCard.jsx");

const person = (state, status = "ready") => ({
  entity: { entity_id: "person.samuel_lawrence", state, attributes: { friendly_name: "Samuel Lawrence" } },
  status,
});
const badge = (container) => container.querySelector(".presence-badge");

beforeEach(() => {
  fixture.current = { entity: null, status: "loading" };
});

describe("PresenceCard", () => {
  it("says Home when HA says home", () => {
    fixture.current = person("home");
    const { container } = render(<PresenceCard />);
    expect(badge(container)).toHaveTextContent("Home");
    expect(badge(container)).toHaveClass("home");
  });

  it("says Away for not_home", () => {
    fixture.current = person("not_home");
    const { container } = render(<PresenceCard />);
    expect(badge(container)).toHaveTextContent("Away");
    expect(badge(container)).toHaveClass("away");
    expect(container.querySelector(".where")).toHaveTextContent("Away");
  });

  it("names a zone in the location line and still badges it Away", () => {
    fixture.current = person("Work");
    const { container } = render(<PresenceCard />);
    expect(container.querySelector(".where")).toHaveTextContent("Work");
    expect(badge(container)).toHaveTextContent("Away");
  });

  it("says Unknown — not Away — when no tracker has reported", () => {
    // person.* "unknown" comes back from useEntityStatus as "unavailable".
    fixture.current = person("unknown", "unavailable");
    const { container } = render(<PresenceCard />);
    expect(badge(container)).toHaveTextContent("Unknown");
    expect(badge(container)).toHaveClass("unknown");
    expect(badge(container)).not.toHaveClass("away");
    expect(screen.queryByText("Away")).toBeNull();
    // and never the raw state string
    expect(container.querySelector(".where")).toHaveTextContent("—");
  });

  it("says Unknown when the person entity is missing altogether", () => {
    fixture.current = { entity: null, status: "not_found" };
    const { container } = render(<PresenceCard />);
    expect(badge(container)).toHaveTextContent("Unknown");
    expect(screen.queryByText("Away")).toBeNull();
    expect(screen.getByRole("img", { name: /not found/ })).toBeInTheDocument();
  });

  it("shows the loading skeleton, with no badge, before the socket has answered", () => {
    const { container } = render(<PresenceCard />);
    expect(container.querySelector(".entity-loading")).not.toBeNull();
    expect(badge(container)).toBeNull();
  });
});
