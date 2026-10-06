/* A notice that lasts until Home Assistant has gone away and come back.

   Shared by SystemActionsCard (Restart HA / Reboot Pi) and AddonsCard (the
   Core / OS / Supervisor installs): once one of those calls has gone out, the
   card says so ("Restarting… the dashboard will reconnect") instead of
   saying nothing, or — before callService's `expectDisconnect` — a toast
   saying it failed. Lives beside useArmedConfirm.js for the same reason: only
   this tab takes the house down on purpose.

   It clears itself when the connection, having dropped, is "ready" again,
   which is the moment the sentence stops being true. A restart that never
   drops the connection (HA refused it, or a Supervisor update that restarts
   only the Supervisor) would leave "Restarting…" up for good, so it also
   gives up after NOTICE_CAP_MS — long enough for a Pi reboot. */
import { useState, useEffect, useRef } from "react";
import { useConnectionStatus } from "../../ha/useEntity.js";

export const NOTICE_CAP_MS = 10 * 60_000;

export function useReconnectNotice() {
  const status = useConnectionStatus();
  const [notice, setNotice] = useState(null);
  const dropped = useRef(false);

  useEffect(() => {
    if (notice == null) {
      dropped.current = false;
      return;
    }
    if (status !== "ready") dropped.current = true;
    else if (dropped.current) setNotice(null);
  }, [notice, status]);

  useEffect(() => {
    if (notice == null) return undefined;
    const id = setTimeout(() => setNotice(null), NOTICE_CAP_MS);
    return () => clearTimeout(id);
  }, [notice]);

  return [notice, setNotice];
}
