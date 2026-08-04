/* The bar that tells a wall-mounted dashboard a new build exists.

   Two things here are easy to get wrong and invisible until production, so
   both are pinned:

   1. The POLL. A service worker only looks for a new version on page load and
      navigation. Glasshouse is opened once and then never reloaded or
      navigated, so without an explicit `registration.update()` on a timer the
      bar would simply never appear — a feature that passes every other check
      and does nothing. The interval tests are the only thing standing between
      that and a silent no-op.

   2. FAILING CLOSED. If the service worker never registered, there is no
      update machinery at all, and a bar offering to refresh into a new version
      would be lying about something it cannot do. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { UpdatePrompt } from "../../src/components/UpdatePrompt.jsx";
import { __reset, __arriveUpdate, __updateCalls } from "../stubs/pwaRegister.js";

const THIRTY_MIN = 30 * 60 * 1000;

/** A stand-in for the ServiceWorkerRegistration the browser hands back. */
function fakeRegistration() {
  return { update: vi.fn(() => Promise.resolve()) };
}

/** jsdom reports "visible" by default; this forces the other case. */
function setVisibility(value) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  __reset();
  setVisibility("visible");
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

describe("UpdatePrompt — what is on screen", () => {
  it("shows nothing until an update actually arrives", () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });

  it("keeps its live region mounted while idle, so the first message is announced", () => {
    const { container } = render(<UpdatePrompt />);
    // A live region inserted in the same DOM mutation as its text is never
    // read out — screen readers only report changes to a region already there.
    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it("offers the refresh once an update arrives", () => {
    render(<UpdatePrompt />);
    act(() => __arriveUpdate());
    expect(screen.getByText("A new version of Glasshouse is ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("stays put — no auto-dismiss timer, unlike the error toast", () => {
    vi.useFakeTimers();
    try {
      render(<UpdatePrompt />);
      act(() => __arriveUpdate());
      // The service error toast clears itself after 6s. A glanced-at wall
      // dashboard would simply miss that, so this one must not.
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("UpdatePrompt — the buttons", () => {
  it("asks for a reloading swap when Refresh is pressed", () => {
    render(<UpdatePrompt />);
    act(() => __arriveUpdate());
    act(() => screen.getByRole("button", { name: "Refresh" }).click());
    // `true` is what makes it reload into the new version rather than just
    // activating the worker and leaving the old page running.
    expect(__updateCalls()).toEqual([true]);
  });

  it("can be dismissed without updating", () => {
    render(<UpdatePrompt />);
    act(() => __arriveUpdate());
    act(() => screen.getByRole("button", { name: "Dismiss update notice" }).click());
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(__updateCalls()).toEqual([]);
  });

  it("moves the error toasts clear while it is up, and puts them back after", () => {
    render(<UpdatePrompt />);
    expect(document.body.classList.contains("has-update-prompt")).toBe(false);
    act(() => __arriveUpdate());
    expect(document.body.classList.contains("has-update-prompt")).toBe(true);
    act(() => screen.getByRole("button", { name: "Dismiss update notice" }).click());
    expect(document.body.classList.contains("has-update-prompt")).toBe(false);
  });
});

describe("UpdatePrompt — the poll that makes it work at all", () => {
  it("checks for a new build on a timer, because nothing ever reloads this page", () => {
    vi.useFakeTimers();
    try {
      const registration = fakeRegistration();
      __reset({ registration });
      render(<UpdatePrompt />);

      expect(registration.update).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(THIRTY_MIN));
      expect(registration.update).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(THIRTY_MIN * 3));
      expect(registration.update).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll while the tab is hidden", () => {
    vi.useFakeTimers();
    try {
      const registration = fakeRegistration();
      __reset({ registration });
      render(<UpdatePrompt />);
      setVisibility("hidden");
      act(() => vi.advanceTimersByTime(THIRTY_MIN * 2));
      expect(registration.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll while offline", () => {
    vi.useFakeTimers();
    try {
      const registration = fakeRegistration();
      __reset({ registration });
      render(<UpdatePrompt />);
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      act(() => vi.advanceTimersByTime(THIRTY_MIN * 2));
      expect(registration.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks immediately when a backgrounded tab comes back", () => {
    const registration = fakeRegistration();
    __reset({ registration });
    render(<UpdatePrompt />);

    setVisibility("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(registration.update).not.toHaveBeenCalled();

    setVisibility("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("stops polling once unmounted", () => {
    vi.useFakeTimers();
    try {
      const registration = fakeRegistration();
      __reset({ registration });
      const { unmount } = render(<UpdatePrompt />);
      unmount();
      act(() => vi.advanceTimersByTime(THIRTY_MIN * 3));
      expect(registration.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("UpdatePrompt — when the service worker never registered", () => {
  it("offers nothing, rather than a refresh it cannot deliver", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    __reset({ registerError: new Error("registration blocked") });
    render(<UpdatePrompt />);
    act(() => __arriveUpdate());
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
  });
});
