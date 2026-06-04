import { useState, useEffect } from "react";
import { nowFractionalHour } from "../theme.js";

export function useNow() {
  const [now, setNow] = useState(() => nowFractionalHour());
  useEffect(() => {
    const id = setInterval(() => setNow(nowFractionalHour()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
