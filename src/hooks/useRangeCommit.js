import { useEffect, useRef } from "react";

/* ----------------------------------------------------------------
   Range slider commit — every slider that sends a value to Home
   Assistant uses this (media volume, light brightness and colour
   temperature, the desk strip, the diffuser LED), so they can't drift
   apart again. Returns a ref to put on the <input type="range">.

   Commits on the native `change` event. React's onChange is the `input`
   event, so it can't be used for this; and the pointerup/keyup wiring this
   replaced misses assistive tech entirely — a VoiceOver swipe or TalkBack
   adjust fires input + change and no pointer or key event, so the readout
   moved and Home Assistant never heard. `change` fires once on pointer
   release, once per keyboard step, and once per AT adjustment. Tabbing past
   the slider fires nothing. Keep a React onChange on the input for the live
   readout; this hook only does the send.

   Trailing debounce: a held arrow key fires `change` on every auto-repeat,
   and each one would be a service call (and, for Spotify, an API call). Only
   the value the slider settles on is sent. A pending value is flushed on
   unmount, not dropped. `commit` is always the latest one passed, so its
   guards (is the light still on?) are judged when the value is sent.

   The attach effect has no dependency array on purpose: the slider sits
   inside EntityGuard, which shows a skeleton instead while loading and can
   remount it when the status changes, so it re-attaches after every render
   to whichever element is there now.
   ----------------------------------------------------------------*/
const RANGE_COMMIT_MS = 300;

export function useRangeCommit(commit) {
  const el = useRef(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const pending = useRef(null); // { timer, value }

  useEffect(() => {
    const node = el.current;
    if (!node) return undefined;
    const onChange = () => {
      clearTimeout(pending.current?.timer);
      const value = Number(node.value);
      const timer = setTimeout(() => { pending.current = null; commitRef.current(value); }, RANGE_COMMIT_MS);
      pending.current = { timer, value };
    };
    node.addEventListener("change", onChange);
    return () => node.removeEventListener("change", onChange);
  });

  useEffect(() => () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    commitRef.current(p.value);
  }, []);

  return el;
}
