/* Two-step confirm for the System tab's destructive controls: the first press
   arms an id, a second press on the same id fires it.

   Shared by SystemActionsCard (Restart HA / Reboot Pi), AddonsCard (Core / OS /
   Supervisor installs) and ErrorLogCard (Clear). It lives beside them rather
   than in hooks/ because nothing outside this tab arms anything.

   Two guards the bare `if (armed === id) run()` lacked, both earned:
   - A confirming press inside ARM_LOCK_MS of the PREVIOUS press is ignored —
     any press, not just the arming one. The confirm renders on the same
     button, in the same place, so a double-click used to arm and fire in one
     gesture; and with the lock measured only from arming, a triple-click or a
     held Enter key (auto-repeat) still walked straight through it. Each
     ignored press restarts the lock, so the confirm takes a separate, second
     press after a pause.
   - An armed id disarms itself after ARM_EXPIRE_MS. A tile left reading
     "Confirm?" on a wall tablet could otherwise be fired hours later by
     whoever touched it next.

   The clock is read in the press handler, never during render (LESSONS.md
   pattern 1). */
import { useState, useEffect, useRef } from "react";

export const ARM_LOCK_MS = 600;
export const ARM_EXPIRE_MS = 5000;

export function useArmedConfirm() {
  const [armed, setArmed] = useState(null);
  const lastPressAt = useRef(0);

  useEffect(() => {
    if (armed == null) return undefined;
    const id = setTimeout(() => setArmed(null), ARM_EXPIRE_MS);
    return () => clearTimeout(id);
  }, [armed]);

  /* true → the caller should run the action now. */
  function request(id) {
    const now = Date.now();
    const sinceLast = now - lastPressAt.current;
    lastPressAt.current = now;
    if (armed !== id) {
      setArmed(id);
      return false;
    }
    if (sinceLast < ARM_LOCK_MS) return false;
    setArmed(null);
    return true;
  }

  const disarm = () => setArmed(null);

  return { armed, request, disarm };
}
