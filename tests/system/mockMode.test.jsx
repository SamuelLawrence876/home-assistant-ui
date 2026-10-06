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

const noNaN = (container) => expect(container.textContent).not.toMatch(/NaN|Invalid Date|undefined/);

describe("System cards in mock mode", () => {
  it("AddonsCard waits for entities", () => {
    const { container } = render(<AddonsCard />);
    expect(screen.getByText("Waiting for update entities…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
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
    noNaN(container);
  });

  it("InProgressCard shows its skeleton", () => {
    const { container } = render(<InProgressCard />);
    expect(screen.getByText("In Progress · — items")).toBeTruthy();
    expect(container.querySelector(".entity-loading")).toBeTruthy();
    noNaN(container);
  });
});
