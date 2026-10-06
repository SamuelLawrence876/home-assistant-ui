/* The notice after Restart HA / Reboot Pi / a Core, OS or Supervisor install.

   It used to clear on any drop-and-reconnect. The dashboard's own connection
   can drop while the call is in flight, though (a phone changing networks, a
   Funnel blip): callService then resolves `{ connectionLost: true }` for a
   command Home Assistant never received, the socket comes straight back, and
   the notice cleared — a restart that never happened, reported as one that
   worked. Now a restart is judged by Home Assistant's start time
   (sensor.uptime), and a reconnect alone proves nothing. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../src/ha/socket.js", async () => (await import("./fakeHa.js")).socketMock);

import { ha, setStatus, report, uptime, resetHa } from "./fakeHa.js";
import {
  prepareNotice,
  useReconnectNotice,
  clearNotices,
  NOTICE_CAP_MS,
  RESTART_GRACE_MS,
  VERIFY_WAIT_MS,
  REPORT_CAP_MS,
  OUTCOME_MS,
} from "../../src/cards/system/useReconnectNotice.js";
import { getEntries, clearErrors } from "../../src/lib/errorLog.js";

const T0 = "2026-10-01T08:00:00+00:00";
const T1 = "2026-10-06T12:00:30+00:00";
const NOW = Date.parse("2026-10-06T12:00:00Z");

const RESTART = {
  kind: "restart",
  logAs: "homeassistant.restart",
  label: "Restart HA",
  text: "Restarting… the dashboard will reconnect.",
  checkText: "Reconnected — checking Home Assistant restarted…",
  failText: "Home Assistant didn't restart — try again.",
  unsureText: "Reconnected, but couldn't confirm Home Assistant restarted.",
};

const notice = () => renderHook(() => useReconnectNotice("t"));
const advance = (ms) => act(() => vi.advanceTimersByTime(ms));
const begin = (spec = RESTART, result) => {
  const go = prepareNotice("t", "key", spec);
  act(() => go(result));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearNotices();
  resetHa();
  clearErrors();
  ha.entities["sensor.uptime"] = uptime(T0);
});
afterEach(() => {
  clearNotices();
  vi.useRealTimers();
});

describe("a restart is judged by Home Assistant's start time", () => {
  it("a reconnect to the same Home Assistant is not a restart: it says so, and logs it", () => {
    const { result } = notice();
    // The blip: the frame was dropped, the socket closed, then came straight back.
    setStatus("disconnected");
    begin(RESTART, { connectionLost: true });
    expect(result.current.message).toBe(RESTART.text);
    setStatus("ready");
    report(uptime(T0)); // the fresh snapshot: same start time
    // Not yet — homeassistant.restart checks the config before it stops.
    expect(result.current.message).toBe(RESTART.checkText);
    expect(getEntries()).toEqual([]);

    advance(RESTART_GRACE_MS);
    expect(result.current.message).toBe(RESTART.failText);
    expect(result.current.outcome).toBe("failed");
    expect(result.current.pending).toBe(false);
    expect(getEntries().map((e) => e.message)).toEqual([
      "homeassistant.restart: Home Assistant didn't restart (the command may not have reached it)",
    ]);
  });

  it("a start time that moved clears it, with nothing logged", () => {
    const { result } = notice();
    begin(RESTART, undefined); // HA answered before it went
    setStatus("disconnected");
    advance(90_000);
    expect(result.current.message).toBe(RESTART.text);
    setStatus("ready");
    report(uptime(T1));
    expect(result.current).toBeNull();
    expect(getEntries()).toEqual([]);
  });

  /* An OS update holds the call open for minutes, then reboots. Timed from the
     press, the cap and the grace were both gone before the reboot started. */
  describe("a long install", () => {
    const OS = { ...RESTART, logAs: "update.install", entityId: "update.home_assistant_operating_system_update" };
    const os = (inProgress) => ({ entity_id: OS.entityId, state: "on", attributes: { in_progress: inProgress } });

    it("isn't judged 'never dropped' while it is still running past the cap, nor right after", () => {
      const { result } = notice();
      report(os(true));
      begin(OS, undefined);
      for (let t = 0; t < NOTICE_CAP_MS + 120_000; t += 60_000) {
        advance(60_000);
        report(os(true)); // still writing the image
      }
      report(os(false)); // done; the reboot is scheduled
      advance(30_000);
      expect(result.current.outcome).toBe(null);
      setStatus("disconnected");
      advance(60_000);
      setStatus("ready");
      report(uptime(T1));
      expect(result.current).toBeNull();
      expect(getEntries()).toEqual([]);
    });

    it("a phone that dropped mid-install waits out the grace from the install's end, not the press", () => {
      const { result } = notice();
      report(os(true));
      setStatus("disconnected");
      begin(OS, { connectionLost: true }); // the phone locked during the install
      advance(5 * 60_000);
      setStatus("ready");
      report(os(true), uptime(T0)); // back: the same HA, still installing
      advance(60_000);
      report(os(false)); // finished; the Supervisor reboots a few seconds later
      advance(5_000);
      expect(result.current.outcome).toBe(null); // not "didn't restart"
      setStatus("disconnected");
      advance(60_000);
      setStatus("ready");
      report(uptime(T1));
      expect(result.current).toBeNull();
    });
  });

  it("doesn't judge the cached start time before the fresh snapshot lands", () => {
    const { result } = notice();
    setStatus("disconnected");
    begin(RESTART, { connectionLost: true });
    setStatus("ready");
    advance(RESTART_GRACE_MS + 1000);
    // Still the old value in the cache, but nothing fresh has arrived.
    expect(result.current.message).toBe(RESTART.checkText);
    report(uptime(T0));
    expect(result.current.message).toBe(RESTART.failText);
  });

  /* The library merges a reconnect's snapshot into its old store: an entity a
     restarting HA hasn't loaded yet keeps its pre-drop object, start time and
     all. Judging that would say "didn't restart" about a restart. */
  it("a snapshot that hasn't re-sent sensor.uptime yet is not judged", () => {
    const { result } = notice();
    setStatus("disconnected");
    begin(RESTART, { connectionLost: true });
    setStatus("ready");
    report({ entity_id: "light.desk", state: "on", attributes: {} }); // HA's first batch, uptime not loaded
    advance(RESTART_GRACE_MS + 60_000);
    expect(result.current.message).toBe(RESTART.checkText);
    expect(getEntries()).toEqual([]);
    report(uptime(T1)); // the uptime integration loads
    expect(result.current).toBeNull();
  });

  it("a start time that moves later clears a 'didn't restart' too", () => {
    const { result } = notice();
    setStatus("disconnected");
    begin(RESTART, { connectionLost: true });
    setStatus("ready");
    report(uptime(T0));
    advance(RESTART_GRACE_MS);
    expect(result.current.outcome).toBe("failed");
    setStatus("disconnected");
    setStatus("ready");
    report(uptime(T1));
    expect(result.current).toBeNull();
  });

  it("no drop at all by the cap: it didn't restart", () => {
    const { result } = notice();
    begin(RESTART, undefined);
    advance(NOTICE_CAP_MS - 1000);
    expect(result.current.message).toBe(RESTART.text);
    advance(1000);
    expect(result.current.message).toBe(RESTART.failText);
    expect(getEntries()[0].detail).toMatch(/never dropped the connection/);
  });

  it("an install HA still calls running gets no verdict until it stops", () => {
    const core = { entity_id: "update.home_assistant_core_update", state: "on", attributes: { in_progress: true } };
    ha.entities[core.entity_id] = core;
    const { result } = notice();
    setStatus("disconnected");
    begin({ ...RESTART, logAs: "update.install", entityId: core.entity_id }, { connectionLost: true });
    setStatus("ready");
    report(uptime(T0), core); // the blip came mid-backup; HA is still installing
    advance(NOTICE_CAP_MS);
    expect(result.current.pending).toBe(true);
    report({ ...core, attributes: { in_progress: false } });
    // The reboot comes a few seconds after the install stops, so the grace
    // runs from here — not from the press, ten minutes ago.
    expect(result.current.pending).toBe(true);
    advance(RESTART_GRACE_MS);
    expect(result.current.message).toBe(RESTART.failText);
    expect(getEntries()[0].detail).toBe(
      "update.home_assistant_core_update · The dashboard reconnected and Home Assistant's start time (sensor.uptime) hadn't moved",
    );
  });

  it("no start time to compare: 'couldn't confirm', never 'done', and not logged", () => {
    ha.entities["sensor.uptime"] = uptime("unavailable");
    const { result } = notice();
    setStatus("disconnected");
    begin(RESTART, { connectionLost: true });
    setStatus("ready");
    report(uptime("unavailable"));
    advance(VERIFY_WAIT_MS - 1000);
    expect(result.current.message).toBe(RESTART.checkText);
    advance(1000);
    expect(result.current.message).toBe(RESTART.unsureText);
    expect(getEntries()).toEqual([]);
    // A start time after the call turns up later: that is a restart.
    report(uptime(new Date(Date.now()).toISOString()));
    expect(result.current).toBeNull();
  });

  it("with no reading before the call, an old start time afterwards is not a restart", () => {
    delete ha.entities["sensor.uptime"];
    const { result } = notice();
    setStatus("disconnected");
    begin(RESTART, { connectionLost: true });
    setStatus("ready");
    report(uptime(T0));
    advance(RESTART_GRACE_MS);
    expect(result.current.message).toBe(RESTART.failText);
  });

  it("an outcome goes away on its own eventually", () => {
    const { result } = notice();
    begin(RESTART, undefined);
    advance(NOTICE_CAP_MS);
    expect(result.current.outcome).toBe("failed");
    advance(OUTCOME_MS);
    expect(result.current).toBeNull();
  });

  it("lives outside the card: unmount, drop, come back — the drop still counted", () => {
    const first = notice();
    begin(RESTART, undefined);
    first.unmount(); // switched tab
    setStatus("disconnected");
    const back = notice();
    expect(back.result.current.message).toBe(RESTART.text);
    back.unmount();
    setStatus("ready");
    report(uptime(T0));
    advance(RESTART_GRACE_MS);
    expect(notice().result.current.message).toBe(RESTART.failText);
  });
});

describe("the Supervisor: no restart to check, so it waits for HA to report", () => {
  const SUP = { kind: "report", label: "Home Assistant Supervisor", text: "Update sent — waiting for the Supervisor to report back" };
  const sup = (extra = {}) => ({
    entity_id: "update.home_assistant_supervisor_update",
    state: "on",
    last_updated: "2026-10-06T11:59:00+00:00",
    attributes: { installed_version: "2026.09.3", latest_version: "2026.10.0", in_progress: false, ...extra },
  });
  const spec = { ...SUP, entityId: "update.home_assistant_supervisor_update" };

  it("clears when HA reports the entity again, even still 'on'", () => {
    ha.entities[spec.entityId] = sup();
    const { result } = notice();
    begin(spec, {});
    expect(result.current.message).toBe(SUP.text);
    // A reconnect re-sends the same values: not a report.
    setStatus("disconnected");
    setStatus("ready");
    report(sup());
    expect(result.current.pending).toBe(true);
    report({ ...sup(), last_updated: "2026-10-06T12:01:00+00:00" });
    expect(result.current).toBeNull();
  });

  it("measures from when the call came back: HA's in_progress on/off during the call doesn't count", () => {
    ha.entities[spec.entityId] = sup();
    const go = prepareNotice("t", "key", spec);
    report(sup({ in_progress: true }));
    report({ ...sup(), last_updated: "2026-10-06T12:00:05+00:00" });
    act(() => go({}));
    const { result } = notice();
    expect(result.current.pending).toBe(true);
  });

  it("lets go after a short cap if HA never reports", () => {
    ha.entities[spec.entityId] = sup();
    const { result } = notice();
    begin(spec, {});
    advance(REPORT_CAP_MS - 1000);
    expect(result.current.pending).toBe(true);
    advance(1000);
    expect(result.current).toBeNull();
    expect(getEntries()).toEqual([]);
  });
});
