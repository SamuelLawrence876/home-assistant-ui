/* "Backup now" used to animate a random 0→100% bar over ~3.5s whatever the
   real backup did: it reached 100% through a rejected call, and while a
   successful backup still had minutes to run. Nothing measures a percentage,
   so the card must never show one. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const fixtures = { entities: {} };
const callService = vi.fn();

const lookup = (id) => fixtures.entities[id] ?? { entity: null, status: "loading" };
vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: (id) => lookup(id),
  useEntity: (id) => lookup(id).entity,
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (...args) => callService(...args),
}));

import { BackupCard, FAILED_MS } from "../../src/cards/system/BackupCard.jsx";

const ready = (state) => ({ entity: { state, attributes: {} }, status: "ready" });
const base = (managerState = "idle") => ({
  "sensor.backup_last_successful_automatic_backup": ready("2026-10-05T03:00:00+00:00"),
  "sensor.backup_backup_manager_state": ready(managerState),
});
const button = () => screen.getByRole("button");

beforeEach(() => {
  vi.useFakeTimers();
  callService.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("BackupCard", () => {
  it("says the backup failed when the call is rejected — and never shows a percentage", async () => {
    fixtures.entities = base();
    callService.mockRejectedValue(new Error("Backup failed: no agents"));
    render(<BackupCard />);
    fireEvent.click(button());
    expect(button().textContent).toBe("Starting…");
    await act(() => Promise.resolve());

    for (let t = 0; t < 4000; t += 220) {
      expect(button().textContent).not.toMatch(/%/);
      act(() => vi.advanceTimersByTime(220));
    }
    expect(button().textContent).toBe("Backup failed · retry");
    expect(button().disabled).toBe(false);

    act(() => vi.advanceTimersByTime(FAILED_MS));
    expect(button().textContent).toBe("Backup now");
  });

  it("holds 'Starting…' while the call is out and the manager hasn't moved", () => {
    fixtures.entities = base();
    callService.mockReturnValue(new Promise(() => {}));
    render(<BackupCard />);
    fireEvent.click(button());
    act(() => vi.advanceTimersByTime(30_000));
    expect(button().textContent).toBe("Starting…");
    expect(button().disabled).toBe(true);
  });

  it("hands over to the manager's real state once it leaves idle", () => {
    fixtures.entities = base("create_backup");
    render(<BackupCard />);
    expect(button().textContent).toBe("Backup create_backup");
    expect(button().disabled).toBe(true);
  });

  it("does not call a missing manager sensor 'idle'", () => {
    fixtures.entities = { "sensor.backup_last_successful_automatic_backup": ready("2026-10-05T03:00:00+00:00") };
    render(<BackupCard />);
    expect(screen.queryByText("idle")).toBeNull();
    expect(button().textContent).toBe("Backup now");
  });
});
