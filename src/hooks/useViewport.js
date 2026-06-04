/* "phone" | "desktop", live-tracking the 768px breakpoint.
   ?viewport=phone|desktop pins it (used by the canvas phone preview). */
import { useState, useEffect, useMemo } from "react";
import { readURLParam } from "../lib/url.js";

export function useViewport() {
  const urlPin = useMemo(() => {
    const p = readURLParam("viewport", null);
    return p === "phone" || p === "desktop" ? p : null;
  }, []);
  const [v, setV] = useState(() => {
    if (urlPin) return urlPin;
    if (typeof window === "undefined") return "desktop";
    return window.matchMedia("(max-width: 768px)").matches ? "phone" : "desktop";
  });
  useEffect(() => {
    if (urlPin) return;
    const mql = window.matchMedia("(max-width: 768px)");
    const onChange = (e) => setV(e.matches ? "phone" : "desktop");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [urlPin]);
  return v;
}
