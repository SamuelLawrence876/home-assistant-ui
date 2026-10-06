/* The commit hook behind every slider that sends a value to Home Assistant
   (volume, light brightness and colour temperature, the desk strip, the
   diffuser LED). It exists because pointerup/keyup wiring misses assistive
   tech: a VoiceOver swipe or TalkBack adjust fires input + change and no
   pointer or key event, so the readout moved and HA never heard. Pinned
   here: the native change event commits, a burst of changes is one send,
   nothing else sends, a pending value survives unmount, and the hook
   re-attaches when EntityGuard swaps the slider out and back. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { useRangeCommit } from "../../src/hooks/useRangeCommit.js";

const sent = [];

function Slider({ show = true, onCommit = (v) => sent.push(v) }) {
  const [v, setV] = useState(10);
  const ref = useRangeCommit(onCommit);
  if (!show) return <div>skeleton</div>;
  return (
    <input ref={ref} type="range" min="0" max="100" value={v} aria-label="Level"
      onChange={(e) => setV(Number(e.target.value))} />
  );
}
const slider = () => screen.getByRole("slider", { name: "Level" });
const wait = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  sent.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useRangeCommit", () => {
  it("commits an assistive-tech adjustment (input + change, no pointer or key)", () => {
    render(<Slider />);
    fireEvent.input(slider(), { target: { value: "60" } });
    fireEvent.change(slider(), { target: { value: "60" } });
    expect(sent).toEqual([]); // debounced, not per event
    wait(300);
    expect(sent).toEqual([60]);
  });

  it("collapses a held arrow key's per-step changes into the value it settles on", () => {
    render(<Slider />);
    for (let v = 11; v <= 20; v++) {
      fireEvent.change(slider(), { target: { value: String(v) } });
      wait(30);
    }
    wait(300);
    expect(sent).toEqual([20]);
  });

  it("sends nothing for input alone, a pointer release or the Tab that focused it", () => {
    render(<Slider />);
    fireEvent.input(slider(), { target: { value: "40" } }); // mid-drag
    fireEvent.pointerUp(slider());
    fireEvent.keyUp(slider(), { key: "Tab" });
    wait(1000);
    expect(sent).toEqual([]);
  });

  it("flushes a pending value on unmount instead of dropping it", () => {
    const { unmount } = render(<Slider />);
    fireEvent.change(slider(), { target: { value: "70" } });
    unmount();
    expect(sent).toEqual([70]);
  });

  it("uses the latest commit callback, so its guards are judged at send time", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Slider onCommit={first} />);
    fireEvent.change(slider(), { target: { value: "30" } });
    rerender(<Slider onCommit={second} />);
    wait(300);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(30);
  });

  it("re-attaches to a slider that was swapped out and back (EntityGuard skeleton)", () => {
    const { rerender } = render(<Slider />);
    rerender(<Slider show={false} />);
    rerender(<Slider show />);
    fireEvent.change(slider(), { target: { value: "55" } });
    wait(300);
    expect(sent).toEqual([55]);
  });
});
