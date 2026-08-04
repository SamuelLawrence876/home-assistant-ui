/* The optimistic on/off toggle every light, switch and purifier card is built
   on. Two behaviours matter: the switch moves the instant you press it, and it
   goes back to the truth if Home Assistant refuses. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const entityState = { current: { entity: null, status: "loading" } };
const callService = vi.fn();

vi.mock("../../src/ha/useEntity.js", () => ({
  useEntityStatus: () => entityState.current,
}));
vi.mock("../../src/ha/client.js", () => ({
  callService: (...args) => callService(...args),
}));

const { useOptimisticToggle } = await import("../../src/hooks/useOptimistic.js");

const entity = (state) => ({ entity: { entity_id: "light.desk", state }, status: "ready" });

/* A promise this test decides the fate of, so "did the UI move before the
   call came back?" is actually observable. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  entityState.current = entity("off");
  callService.mockReset();
  callService.mockResolvedValue(undefined);
});

describe("useOptimisticToggle", () => {
  it("starts in whatever state the entity is already in", () => {
    entityState.current = entity("on");
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));
    expect(result.current.on).toBe(true);
  });

  it("starts off when the entity has not arrived yet", () => {
    entityState.current = { entity: null, status: "loading" };
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));
    expect(result.current.on).toBe(false);
  });

  it("moves the switch immediately, before Home Assistant has answered", () => {
    const pending = deferred();
    callService.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));

    act(() => result.current.toggle());

    expect(result.current.on).toBe(true); // call still in flight
    expect(callService).toHaveBeenCalledWith("light", "turn_on", { entity_id: "light.desk" });
  });

  it("asks for turn_off when it is already on", () => {
    entityState.current = entity("on");
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));
    act(() => result.current.toggle());
    expect(callService).toHaveBeenCalledWith("light", "turn_off", { entity_id: "light.desk" });
  });

  it("infers the service domain from the entity id, and lets a caller override it", () => {
    entityState.current = { entity: { entity_id: "switch.fan", state: "off" }, status: "ready" };
    const { result } = renderHook(() => useOptimisticToggle("switch.fan"));
    act(() => result.current.toggle());
    expect(callService).toHaveBeenCalledWith("switch", "turn_on", { entity_id: "switch.fan" });

    const { result: r2 } = renderHook(() => useOptimisticToggle("switch.fan", "homeassistant"));
    act(() => r2.current.toggle());
    expect(callService).toHaveBeenLastCalledWith("homeassistant", "turn_on", { entity_id: "switch.fan" });
  });

  it("puts the switch back when the service call fails", async () => {
    callService.mockRejectedValue(new Error("entity not found"));
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));

    await act(async () => {
      result.current.toggle();
    });

    await waitFor(() => expect(result.current.on).toBe(false));
  });

  it("puts it back to what Home Assistant now says, not to what it said when you pressed", async () => {
    // An automation turns the light on while our turn_off is in flight, and
    // our call then fails. Reverting to the click-time boolean would leave the
    // dashboard claiming "off" over a light that is on, and it would stick
    // until the entity moved again.
    const pending = deferred();
    callService.mockReturnValue(pending.promise);
    entityState.current = entity("off");
    const { result, rerender } = renderHook(() => useOptimisticToggle("light.desk"));

    act(() => result.current.toggle()); // optimistically on
    entityState.current = entity("on"); // HA agrees, from somewhere else
    rerender();

    await act(async () => {
      pending.reject(new Error("boom"));
      await pending.promise.catch(() => {});
    });

    await waitFor(() => expect(result.current.on).toBe(true));
  });

  it("follows the entity when it changes under us", () => {
    const { result, rerender } = renderHook(() => useOptimisticToggle("light.desk"));
    expect(result.current.on).toBe(false);
    act(() => {
      entityState.current = entity("on");
      rerender();
    });
    expect(result.current.on).toBe(true);
  });

  it("hands back the entity and its status untouched, so cards can render an unavailable state", () => {
    entityState.current = { entity: { entity_id: "light.desk", state: "unavailable" }, status: "unavailable" };
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));
    expect(result.current.status).toBe("unavailable");
    expect(result.current.entity.state).toBe("unavailable");
    expect(result.current.on).toBe(false);
  });

  it("lets a card set the state directly for a flow that implies one", () => {
    // Picking a colour preset turns the light on without a toggle.
    const { result } = renderHook(() => useOptimisticToggle("light.desk"));
    act(() => result.current.setOn(true));
    expect(result.current.on).toBe(true);
    expect(callService).not.toHaveBeenCalled();
  });
});
