/* "Clear" on the error log had the same one-button confirm as Restart HA:
   a double-click wiped the log, and "Confirm clear" sat armed forever. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { ErrorLogCard } from "../../src/cards/system/ErrorLogCard.jsx";
import { logError, clearErrors, getEntries } from "../../src/lib/errorLog.js";
import { ARM_LOCK_MS, ARM_EXPIRE_MS } from "../../src/cards/system/useArmedConfirm.js";

const clearBtn = () => screen.getByRole("button", { name: /^(Clear|Confirm clear)$/ });

beforeEach(() => {
  vi.useFakeTimers();
  clearErrors();
  logError({ source: "service", message: "light.turn_on failed" });
});
afterEach(() => {
  clearErrors();
  vi.useRealTimers();
});

describe("ErrorLogCard clear", () => {
  it("a double-click does not wipe the log", () => {
    render(<ErrorLogCard />);
    fireEvent.click(clearBtn());
    act(() => vi.advanceTimersByTime(80));
    fireEvent.click(clearBtn());
    expect(getEntries()).toHaveLength(1);
    expect(clearBtn().textContent).toBe("Confirm clear");
  });

  it("a deliberate confirm clears it", () => {
    render(<ErrorLogCard />);
    fireEvent.click(clearBtn());
    act(() => vi.advanceTimersByTime(ARM_LOCK_MS + 50));
    fireEvent.click(clearBtn());
    expect(getEntries()).toHaveLength(0);
  });

  it("the armed confirm expires", () => {
    render(<ErrorLogCard />);
    fireEvent.click(clearBtn());
    act(() => vi.advanceTimersByTime(ARM_EXPIRE_MS));
    expect(clearBtn().textContent).toBe("Clear");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
