/* Words for Home Assistant failures.

   home-assistant-js-websocket rejects with bare numbers when the connection
   itself is the problem — `ERR_CONNECTION_LOST` (3) from a command sent while
   the socket is down, `ERR_CANNOT_CONNECT` (1) / `ERR_INVALID_AUTH` (2) from
   connecting — and a command already in flight when the socket drops is
   rejected with a whole failed result frame,
   `{ type: "result", success: false, error: { code: 3, message } }`.
   Every caller formatted errors as `e?.message || String(e)`, so a toast read
   "3", or "[object Object]", and the error log could only tell "the Pi is
   down" from "the session expired" by a trailing "· 1" or "· 2".

   Home Assistant's own command errors (`{ code: "not_found", message }`) and
   ordinary Errors already carry a message and pass through unchanged. */
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_HTTPS_TO_HTTP,
  ERR_INVALID_AUTH_CALLBACK,
} from "home-assistant-js-websocket";

const LIBRARY_ERRORS = {
  [ERR_CANNOT_CONNECT]: "Could not reach Home Assistant",
  [ERR_INVALID_AUTH]: "Home Assistant session expired",
  [ERR_CONNECTION_LOST]: "Not connected to Home Assistant",
  [ERR_HASS_HOST_REQUIRED]: "Home Assistant URL not set",
  [ERR_INVALID_HTTPS_TO_HTTP]: "Home Assistant URL must be https",
  [ERR_INVALID_AUTH_CALLBACK]: "Home Assistant sign-in callback did not match",
};

const UNKNOWN = "Unknown error";

const libraryCode = (e) => {
  if (Number.isInteger(e)) return e;
  // The library's own "Connection lost" frame. HA's codes are strings, so a
  // numeric one here can only have come from the library.
  const inner = e && typeof e === "object" ? e.error : null;
  return inner && typeof inner === "object" && Number.isInteger(inner.code) ? inner.code : null;
};

/* Always a non-empty string, never throws. */
export function describeHaError(e) {
  try {
    const code = libraryCode(e);
    if (code !== null) return LIBRARY_ERRORS[code] || `Home Assistant error ${code}`;
    if (typeof e === "string") return e || UNKNOWN;
    if (e && typeof e === "object") {
      if (typeof e.message === "string" && e.message) return e.message;
      if (typeof e.error?.message === "string" && e.error.message) return e.error.message;
    }
  } catch {}
  return UNKNOWN;
}

/* The two library shapes above, as a real Error with a readable message and
   the original code kept on `.code`. Anything else is returned untouched —
   HA's own `{ code, message }` already reads fine, and callers may look at
   its string `.code`. */
export function toHaError(e) {
  const code = libraryCode(e);
  if (code === null) return e;
  const err = new Error(describeHaError(e));
  err.code = code;
  return err;
}
