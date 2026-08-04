/* The error log holds three promises: it can never throw, it can never brick
   the app, and it can never store a credential. Seven of the 2026-08 findings
   were leaked or over-shared tokens, so the redaction tests are the point of
   this file.

   The module keeps its entries in module scope and reads localStorage once at
   import, so every test starts from a fresh copy. */
import { describe, it, expect, vi } from "vitest";

const STORAGE_KEY = "gh_error_log";
const freshLog = async () => {
  vi.resetModules();
  return import("../../src/lib/errorLog.js");
};

describe("redact", () => {
  it("strips a bearer token out of a message", async () => {
    const { redact } = await freshLog();
    const out = redact("HA GET /api/states failed, Authorization: Bearer abc.def-123~xyz");
    expect(out).toContain("Bearer [redacted]");
    expect(out).not.toContain("abc.def-123~xyz");
  });

  it("strips a JWT wherever it appears", async () => {
    const { redact } = await freshLog();
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF123_-";
    expect(redact(`token was ${jwt} when it failed`)).not.toContain(jwt);
  });

  it("strips secrets out of a query string", async () => {
    const { redact } = await freshLog();
    const out = redact("GET /auth/token?access_token=s3cr3tvalue&code=abc123&scope=read");
    expect(out).toContain("access_token=[redacted]");
    expect(out).toContain("code=[redacted]");
    expect(out).toContain("scope=read"); // not a secret, kept
    expect(out).not.toContain("s3cr3tvalue");
  });

  it("strips secrets out of a JSON body", async () => {
    const { redact } = await freshLog();
    const out = redact('{"refresh_token": "keep-me-secret", "expires_in": 1800}');
    expect(out).not.toContain("keep-me-secret");
    expect(out).toContain("1800");
  });

  it("strips a long hex run, which is what a refresh token looks like", async () => {
    const { redact } = await freshLog();
    expect(redact(`failed for ${"a1b2c3d4".repeat(8)}`)).toContain("[redacted-hex]");
  });

  it("returns an empty string for anything that is not usable text", async () => {
    const { redact } = await freshLog();
    expect(redact(null)).toBe("");
    expect(redact(undefined)).toBe("");
    expect(redact("")).toBe("");
  });

  it("makes text out of something that is not a string, rather than dropping it", async () => {
    const { redact } = await freshLog();
    expect(redact(404)).toBe("404");
    expect(redact({ a: 1 })).toBe("[object Object]");
  });

  it("clamps a runaway message instead of storing all of it", async () => {
    const { redact } = await freshLog();
    const out = redact("x".repeat(5000));
    expect(out.length).toBeLessThan(700);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("logError", () => {
  it("records an entry and hands it back newest first", async () => {
    const { logError, getEntries } = await freshLog();
    logError({ source: "service", message: "first" });
    logError({ source: "service", message: "second" });
    expect(getEntries().map((e) => e.message)).toEqual(["second", "first"]);
  });

  it("redacts on the way in, so nothing secret is ever written to storage", async () => {
    const { logError } = await freshLog();
    logError({ source: "rest", message: "HA GET /api failed", detail: "Authorization: Bearer supersecrettoken" });
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain("supersecrettoken");
  });

  it("drops an entry with nothing to say rather than storing a blank row", async () => {
    const { logError, getEntries } = await freshLog();
    logError({});
    logError({ source: "service" });
    logError({ message: "" });
    expect(getEntries()).toHaveLength(0);
  });

  it("collapses an identical error repeated within seconds, so a flapping socket cannot flush the log", async () => {
    const { logError, getEntries } = await freshLog();
    for (let i = 0; i < 20; i++) logError({ source: "connection", message: "socket closed" });
    expect(getEntries()).toHaveLength(1);
  });

  it("keeps a cap on how much it remembers", async () => {
    const { logError, getEntries, MAX_ENTRIES } = await freshLog();
    for (let i = 0; i < MAX_ENTRIES + 25; i++) logError({ source: "service", message: `error ${i}` });
    expect(getEntries()).toHaveLength(MAX_ENTRIES);
    expect(getEntries()[0].message).toBe(`error ${MAX_ENTRIES + 24}`);
  });

  it("keeps the same array identity until something actually changes", async () => {
    const { logError, getEntries } = await freshLog();
    logError({ source: "service", message: "one" });
    const before = getEntries();
    expect(getEntries()).toBe(before);
    logError({ source: "service", message: "two" });
    expect(getEntries()).not.toBe(before);
  });

  it("does not throw when storage is full", async () => {
    const { logError, getEntries } = await freshLog();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => logError({ source: "service", message: "still logged in memory" })).not.toThrow();
    expect(getEntries()).toHaveLength(1);
    spy.mockRestore();
  });

  it("tells its subscribers when something is recorded", async () => {
    const { logError, subscribe } = await freshLog();
    const seen = vi.fn();
    const unsubscribe = subscribe(seen);
    logError({ source: "service", message: "one" });
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    logError({ source: "service", message: "two" });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("what is already in storage is treated as hostile", () => {
  it("ignores a corrupt blob instead of taking the app down at import", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { getEntries } = await freshLog();
    expect(getEntries()).toEqual([]);
  });

  it("ignores a stored value that is not a list of entries", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ message: "nope" }));
    const { getEntries } = await freshLog();
    expect(getEntries()).toEqual([]);
  });

  it("drops the unusable rows and keeps the usable ones", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { ts: Date.now(), source: "service", message: "real one" },
        { ts: "not a number", message: "bad timestamp" },
        { ts: Date.now(), message: "" },
        null,
        "a string",
      ]),
    );
    const { getEntries } = await freshLog();
    expect(getEntries().map((e) => e.message)).toEqual(["real one"]);
  });

  it("redacts a credential that an older build had already stored", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ts: Date.now(), source: "rest", message: "failed", detail: "Bearer leakedtoken123" }]),
    );
    const { getEntries } = await freshLog();
    expect(getEntries()[0].detail).not.toContain("leakedtoken123");
  });
});

describe("formatEntries", () => {
  it("says so plainly when there is nothing to report", async () => {
    const { formatEntries } = await freshLog();
    expect(formatEntries([])).toContain("empty");
  });

  it("dumps entries as text without a real timestamp turning into Invalid Date", async () => {
    const { logError, getEntries, formatEntries } = await freshLog();
    logError({ source: "service", message: "light.desk turn_on failed", detail: "not found" });
    const text = formatEntries(getEntries());
    expect(text).toContain("light.desk turn_on failed");
    expect(text).not.toContain("Invalid Date");
    expect(text).not.toContain("NaN");
  });

  it("cannot be made to throw by a malformed entry", async () => {
    const { formatEntries } = await freshLog();
    expect(() => formatEntries(null)).not.toThrow();
    expect(() => formatEntries([{ ts: NaN, source: "x", message: "y" }])).not.toThrow();
  });
});
