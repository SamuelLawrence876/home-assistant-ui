/* "Guest playback · Pi speaker". The entity behind it is the HA Spotify
   integration's *account* player, which follows whatever device the linked
   account is on — and a guest casting from their own account never shows up
   in it. So the card may only say "In use" when the account's source is the
   Pi speaker itself, and must never say "Available" / "Ready for connections",
   which nothing it reads can back up. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const fixtures = { np: undefined };

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => fixtures.np ?? { entity: null, status: "loading" },
}));

import { SpotifyConnectCard } from "../../src/cards/media/SpotifyConnectCard.jsx";

const ready = (state, attributes = {}) => ({ entity: { state, attributes }, status: "ready" });
const meta = (container) => container.querySelector(".meta")?.textContent;
const NEVER = /Available|Ready for connections/;

beforeEach(() => {
  fixtures.np = undefined;
});

describe("SpotifyConnectCard", () => {
  it("the account playing on a phone is not the Pi speaker being in use", () => {
    fixtures.np = ready("playing", { source: "Sam's iPhone", media_title: "Song" });
    const { container } = render(<SpotifyConnectCard />);
    expect(meta(container)).toBe("—");
    expect(container.textContent).toContain("Linked account on Sam's iPhone");
    expect(container.textContent).not.toContain("Playing · Song");
    expect(container.textContent).not.toMatch(NEVER);
  });

  it("the account playing on the Pi speaker is 'In use'", () => {
    fixtures.np = ready("playing", { source: "Home Assistant", media_title: "Song" });
    const { container } = render(<SpotifyConnectCard />);
    expect(meta(container)).toBe("In use");
    expect(container.textContent).toContain("Playing · Song");
  });

  it("paused on the Pi speaker says Paused", () => {
    fixtures.np = ready("paused", { source: "Home Assistant" });
    const { container } = render(<SpotifyConnectCard />);
    expect(meta(container)).toBe("Paused");
  });

  it("idle account: says what it knows, doesn't claim the speaker is free", () => {
    fixtures.np = ready("idle");
    const { container } = render(<SpotifyConnectCard />);
    expect(meta(container)).toBe("—");
    expect(container.textContent).toContain("Not in use by the linked account");
    expect(container.textContent).not.toMatch(NEVER);
  });

  it("loading (and mock mode): em-dashes, no 'Available'", () => {
    const { container } = render(<SpotifyConnectCard />);
    expect(meta(container)).toBe("—");
    expect(container.textContent).not.toMatch(NEVER);
  });

  it("integration unavailable: speaker status unknown, not 'Available'", () => {
    fixtures.np = { entity: { state: "unavailable", attributes: {} }, status: "unavailable" };
    const { container } = render(<SpotifyConnectCard />);
    expect(meta(container)).toBe("—");
    expect(container.textContent).toContain("Status unknown · Spotify integration unavailable");
    expect(container.textContent).not.toMatch(NEVER);
  });
});
