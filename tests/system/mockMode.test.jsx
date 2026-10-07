/* Mock mode (VITE_HA_URL="") is what the screenshot harness renders: no
   socket, every status "loading", no entities at all. Each System-tab card
   changed in the 2026-10 sweep must still render there, with nothing NaN and
   the same visible text as before (the pixel baseline depends on it). */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => ({ entity: undefined, status: "loading" }),
  useEntity: () => undefined,
  useEntitiesByDomain: () => [],
  useConnectionStatus: () => "disconnected",
  useSnapshotReady: () => false, // mock mode never has a snapshot
}));
// The restart notice watches the socket itself. Mock mode: no connection,
// nothing reported.
vi.mock("../../src/ha/socket.js", () => ({
  getConnectionStatus: () => "disconnected",
  getEntity: () => undefined,
  onConnectionChange: (cb) => (cb("disconnected"), () => {}),
  onStatesChanged: () => () => {},
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: () => Promise.reject(new Error("Not connected")),
  getTodoItems: () => Promise.reject(new Error("Not connected")),
}));

import { AddonsCard } from "../../src/cards/system/AddonsCard.jsx";
import { AdGuardSimpleCard } from "../../src/cards/system/AdGuardCard.jsx";
import { BackupCard } from "../../src/cards/system/BackupCard.jsx";
import { StorageCard } from "../../src/cards/system/StorageCard.jsx";
import { SystemActionsCard } from "../../src/cards/system/SystemActionsCard.jsx";
import { ErrorLogCard } from "../../src/cards/system/ErrorLogCard.jsx";
import { InProgressCard } from "../../src/cards/system/InProgressCard.jsx";
import { PiCard } from "../../src/cards/system/PiCard.jsx";

const noNaN = (container) => expect(container.textContent).not.toMatch(/NaN|Invalid Date|undefined/);

describe("System cards in mock mode", () => {
  it("AddonsCard waits for entities", () => {
    const { container } = render(<AddonsCard />);
    expect(screen.getByText("Waiting for update entities…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    // Round 3 (M13): no entities read is not "All up to date ✓ current".
    // This header is a deliberate change to the mock-mode screenshot.
    expect(container.querySelector("h2").textContent).toBe("Can't tell yet");
    expect(container.querySelector(".meta")).toBeNull();
    // Its live region is in the DOM, empty and visually hidden: no pixels.
    expect(container.querySelector("p.visually-hidden[role=status]").textContent).toBe("");
    noNaN(container);
  });

  it("PiCard keeps its skeleton and says 'no readings'", () => {
    const { container } = render(<PiCard />);
    expect(container.querySelector(".meta").textContent).toBe("no readings");
    expect(container.querySelector(".entity-loading")).toBeTruthy();
    noNaN(container);
  });

  it("AdGuardSimpleCard keeps its loading look", () => {
    const { container } = render(<AdGuardSimpleCard />);
    expect(screen.getByText("Off")).toBeTruthy();
    expect(container.querySelector(".entity-loading")).toBeTruthy();
    noNaN(container);
  });

  it("BackupCard offers 'Backup now' as before", () => {
    const { container } = render(<BackupCard />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toBe("Backup now");
    expect(btn.className).toContain("primary");
    noNaN(container);
  });

  it("StorageCard shows its skeleton and a dashed eyebrow", () => {
    const { container } = render(<StorageCard />);
    expect(screen.getByText("Storage · — / 220 GiB used")).toBeTruthy();
    expect(container.querySelector(".entity-loading")).toBeTruthy();
    noNaN(container);
  });

  it("SystemActionsCard and ErrorLogCard render unarmed", () => {
    const { container } = render(
      <>
        <SystemActionsCard />
        <ErrorLogCard />
      </>,
    );
    expect(screen.queryByText("Confirm?")).toBeNull();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    // The restart notice is an empty live region until a restart goes out.
    expect(container.querySelector(".sys-action-note").textContent).toBe("");
    noNaN(container);
  });

  it("InProgressCard shows its skeleton", () => {
    const { container } = render(<InProgressCard />);
    expect(screen.getByText("In Progress · — items")).toBeTruthy();
    expect(container.querySelector(".entity-loading")).toBeTruthy();
    noNaN(container);
  });
});
