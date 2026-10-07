/* Kanban helpers — tag encoding and the due-date chip.

   The due-date chip is where "Invalid Date" reached the screen in the 2026-08
   sweep, and `dueFields` is the thing that decides which of two mutually
   exclusive HA fields a due value goes into. Getting that wrong throws, and a
   throw mid-move is how a task gets deleted from Home Assistant and never
   re-added (LESSONS.md pattern 2). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseTags, buildDescription, fmtDue, dueFields, normaliseTag, tagDropsCharacters, itemRef, boardState,
} from "../../src/cards/schedule/kanbanUtils.js";

describe("parseTags", () => {
  it("pulls hash tags out and leaves the prose behind", () => {
    expect(parseTags("#home #urgent fix the boiler")).toEqual({
      tags: ["home", "urgent"],
      text: "fix the boiler",
    });
  });

  it("copes with no description at all", () => {
    expect(parseTags(undefined)).toEqual({ tags: [], text: "" });
    expect(parseTags(null)).toEqual({ tags: [], text: "" });
    expect(parseTags("")).toEqual({ tags: [], text: "" });
  });

  it("returns no tags when there are none", () => {
    expect(parseTags("just a note")).toEqual({ tags: [], text: "just a note" });
  });

  it("keeps hyphens inside a tag", () => {
    expect(parseTags("#3d-print check the plate").tags).toEqual(["3d-print"]);
  });

  it("reads a non-ASCII tag whole instead of cutting it at the first accent", () => {
    // The ASCII \w pattern read "#café" as a "caf" chip with "é" left in the prose.
    expect(parseTags("#café")).toEqual({ tags: ["café"], text: "" });
    expect(parseTags("#über-wichtig ring the landlord").tags).toEqual(["über-wichtig"]);
  });
});

describe("normaliseTag", () => {
  it("trims before turning spaces into hyphens", () => {
    // Used to store "#urgent-" and "#-urgent"; parseTags can't read the second at all.
    expect(normaliseTag("urgent ")).toBe("urgent");
    expect(normaliseTag(" urgent")).toBe("urgent");
    expect(normaliseTag("  Side   Project ")).toBe("side-project");
  });

  it("drops a leading # and lowercases", () => {
    expect(normaliseTag("#Garden")).toBe("garden");
    expect(normaliseTag("##x")).toBe("x");
  });

  it("drops characters parseTags would stop at, rather than storing them", () => {
    expect(normaliseTag("q&a")).toBe("qa");
    expect(normaliseTag("a - b")).toBe("a-b");
    expect(normaliseTag("--")).toBe("");
    expect(normaliseTag("   ")).toBe("");
    expect(normaliseTag(undefined)).toBe("");
  });

  it("round-trips everything it produces through buildDescription + parseTags", () => {
    for (const raw of ["urgent ", " urgent", "café", "q&a", "Side Project", "3D print", "#über wichtig", "éclair"]) {
      const t = normaliseTag(raw);
      expect(t).not.toBe("");
      expect(parseTags(buildDescription([t], "")).tags).toEqual([t]);
    }
  });

  it("round-trips scripts with combining marks and decomposed input too", () => {
    for (const raw of ["हिंदी", "ภาษาไทย", "café", "İstanbul"]) {
      const t = normaliseTag(raw);
      expect(t).not.toBe("");
      expect(parseTags(buildDescription([t], "")).tags).toEqual([t]);
    }
  });

  it("keeps combining marks — they are part of the word, not punctuation", () => {
    // Devanagari vowel signs are \p{M}: stripping them stored "हिंदी" as "हद".
    expect(normaliseTag("हिंदी")).toBe("हिंदी");
    expect(normaliseTag("café")).toBe("café"); // NFD in, NFC out
  });

  it("never starts a tag with a mark parseTags can't start on", () => {
    expect(normaliseTag("́abc")).toBe("abc");
    expect(normaliseTag("-́x")).toBe("x");
  });

  it("leaves nothing for an emoji, and says less than was typed for 'C++'", () => {
    expect(normaliseTag("😀")).toBe("");
    expect(normaliseTag("C++")).toBe("c");
  });
});

describe("tagDropsCharacters", () => {
  it("is true when typed characters were thrown away", () => {
    expect(tagDropsCharacters("C++")).toBe(true);
    expect(tagDropsCharacters("q&a")).toBe(true);
    expect(tagDropsCharacters("😀")).toBe(true);
  });

  it("is false for spacing, case, hyphen runs or a leading #", () => {
    for (const raw of ["urgent ", "  Side   Project ", "#Garden", "a - b", "हिंदी", "café"]) {
      expect(tagDropsCharacters(raw)).toBe(false);
    }
  });
});

describe("parseTags with marks and other clients' input", () => {
  it("reads a tag with combining marks whole", () => {
    expect(parseTags("#हिंदी practice")).toEqual({ tags: ["हिंदी"], text: "practice" });
  });

  it("reads a decomposed (NFD) tag from another client as the same NFC tag", () => {
    expect(parseTags("#café-crème").tags).toEqual(["café-crème"]);
  });
});

describe("itemRef", () => {
  it("targets an item by uid — HA matches the first uid OR summary, so a summary can hit the wrong one", () => {
    expect(itemRef({ uid: "abc-123", summary: "Water plants" })).toBe("abc-123");
  });

  it("falls back to the summary only for a card with no real uid yet", () => {
    expect(itemRef({ uid: "temp-4", summary: "Water plants" })).toBe("Water plants");
    expect(itemRef({ summary: "Water plants" })).toBe("Water plants");
  });
});

describe("boardState", () => {
  const ids = ["todo.backlog", "todo.next", "__done__"];
  const all = (v) => Object.fromEntries(ids.map((id) => [id, v]));
  const none = all(0);

  it("never says 0 for a column it has not read", () => {
    for (const connStatus of ["disconnected", "connecting", "ready"]) {
      const s = boardState({ connStatus, reads: all("unread"), counts: none });
      for (const id of ids) expect(s.columns[id].count).toBe("—");
      expect(s.total).toBe(null);
    }
  });

  it("says why nothing is there: connecting, not connected, or loading", () => {
    expect(boardState({ connStatus: "connecting", reads: all("unread"), counts: none }).meta).toBe("connecting…");
    expect(boardState({ connStatus: "disconnected", reads: all("unread"), counts: none }).meta).toBe("not connected");
    expect(boardState({ connStatus: "disconnected", reads: all("unread"), counts: none }).columns["todo.next"].note).toBe("Not connected");
    expect(boardState({ connStatus: "ready", reads: all("unread"), counts: none }).meta).toBe("loading…");
  });

  it("tells a failed read apart from an empty column", () => {
    const reads = { ...all("ok"), "todo.next": "error" };
    const s = boardState({ connStatus: "ready", reads, counts: none });
    expect(s.columns["todo.backlog"]).toMatchObject({ count: 0, note: null });
    expect(s.columns["todo.next"]).toMatchObject({ count: "—", note: "Couldn't read this column", tone: "error" });
    expect(s.meta).toBe("some columns couldn't be read");
    expect(s.total).toBe(null);
  });

  it("keeps cards from a failed refresh on screen, with the caveat", () => {
    const reads = { ...all("ok"), "todo.next": "error" };
    const s = boardState({ connStatus: "ready", reads, counts: { ...none, "todo.next": 2 } });
    expect(s.columns["todo.next"]).toMatchObject({ count: 2, tone: "stale" });
    expect(s.columns["todo.next"].note).toMatch(/out of date/);
  });

  it("keeps what it read when the socket drops, and says it may be stale", () => {
    const s = boardState({ connStatus: "disconnected", reads: all("ok"), counts: { ...none, "todo.backlog": 3 } });
    expect(s.meta).toBe("not connected · may be out of date");
    expect(s.columns["todo.backlog"].count).toBe(3);
    expect(s.total).toBe(3);
  });

  it("says the whole board couldn't be read when no column could, not 'some'", () => {
    expect(boardState({ connStatus: "ready", reads: all("error"), counts: none }).meta).toBe("board couldn't be read");
    // ...and that it couldn't be REFRESHED when it is showing what it read before.
    const stale = boardState({ connStatus: "ready", reads: all("error"), counts: { ...none, "todo.backlog": 2 } });
    expect(stale.meta).toBe("board couldn't be refreshed · may be out of date");
  });

  it("shows '—' for a partially read Done rather than the subset it has", () => {
    const reads = { ...all("ok"), __done__: "partial" };
    const s = boardState({ connStatus: "ready", reads, counts: { ...none, __done__: 2 } });
    expect(s.columns.__done__).toMatchObject({ count: "—", note: "Couldn't read all of this column", tone: "error" });
    expect(s.total).toBe(null);
    expect(s.meta).toBe("some columns couldn't be read");
  });

  it("treats an unavailable or missing list as unreadable, whatever its last read said", () => {
    const lists = { "todo.backlog": "ready", "todo.next": "unavailable" };
    const s = boardState({ connStatus: "ready", reads: all("ok"), counts: none, lists });
    expect(s.columns["todo.next"]).toMatchObject({ count: "—", note: "List unavailable", tone: "error" });
    // Done holds that list's completed items, so it has a hole now too.
    expect(s.columns.__done__).toMatchObject({ count: 0, tone: "stale" });
    expect(s.total).toBe(null);
    const gone = boardState({ connStatus: "ready", reads: all("ok"), counts: { ...none, "todo.next": 3 }, lists: { ...lists, "todo.next": "not_found" } });
    expect(gone.columns["todo.next"]).toMatchObject({ count: 3, note: "List not found · may be out of date", tone: "stale" });
  });

  it("ignores list status while offline — the connection is the explanation then", () => {
    const lists = { "todo.backlog": "loading", "todo.next": "unavailable" };
    const s = boardState({ connStatus: "disconnected", reads: all("unread"), counts: none, lists });
    expect(s.columns["todo.next"].note).toBe("Not connected");
    expect(s.meta).toBe("not connected");
  });

  it("states the total only when every column read cleanly", () => {
    const s = boardState({ connStatus: "ready", reads: all("ok"), counts: { "todo.backlog": 2, "todo.next": 1, __done__: 4 } });
    expect(s.total).toBe(7);
    expect(s.meta).toBe("drag cards between columns");
  });

  it("offers Retry on a column whose own read failed, only while connected, never for a dead list", () => {
    const reads = { ...all("ok"), "todo.next": "error", __done__: "partial" };
    const s = boardState({ connStatus: "ready", reads, counts: none });
    expect(s.columns["todo.next"].retry).toBe(true);
    expect(s.columns.__done__.retry).toBe(true);
    expect(s.columns["todo.backlog"].retry).toBeFalsy();
    // A stale column (cards from before, refresh failed) can be retried too.
    expect(boardState({ connStatus: "ready", reads, counts: { ...none, "todo.next": 2 } }).columns["todo.next"])
      .toMatchObject({ tone: "stale", retry: true });
    // Offline, reading again can't run; the connection is the explanation.
    expect(boardState({ connStatus: "disconnected", reads, counts: none }).columns["todo.next"].retry).toBe(false);
    // A dead list recovers when HA has it back, not by asking.
    const dead = boardState({ connStatus: "ready", reads, counts: none, lists: { "todo.next": "unavailable" } });
    // …and Done, which reads that dead list's completed items, can't be retried into working either.
    expect(dead.columns.__done__.retry).toBe(false);
    expect(dead.columns["todo.next"].retry).toBeFalsy();
  });

  /* D5 / D21: after Restart HA a list HA hasn't loaded yet is "loading" while
     the socket is up, and HA can't answer get_items for it — so its read, and
     Done's, fail every time until it arrives. That is a wait, not a fault. */
  describe("a list HA is still loading", () => {
    const lists = { "todo.backlog": "ready", "todo.next": "loading" };
    const reads = { ...all("ok"), "todo.next": "error", __done__: "error" };

    it("reads Loading…, keeps its cards with the caveat, and offers no Retry", () => {
      const s = boardState({ connStatus: "ready", reads, counts: { ...none, "todo.next": 3, __done__: 3 }, lists });
      expect(s.columns["todo.next"]).toEqual({ count: 3, note: "Loading… · may be out of date", tone: "wait" });
      expect(s.columns.__done__).toEqual({ count: 3, note: "Waiting for a list to load · may be out of date", tone: "wait" });
      expect(s.columns["todo.backlog"]).toMatchObject({ count: 0, note: null });
      expect(s.meta).toBe("loading…");
      expect(s.total).toBe(null);
    });

    it("has no count to give for a column with nothing on it, or never read whole", () => {
      const empty = boardState({ connStatus: "ready", reads, counts: none, lists });
      expect(empty.columns["todo.next"]).toEqual({ count: "—", note: "Loading…", tone: "wait" });
      expect(empty.columns.__done__).toEqual({ count: "—", note: "Waiting for a list to load", tone: "wait" });
      const partial = boardState({
        connStatus: "ready", reads: { ...reads, "todo.next": "partial", __done__: "partial" },
        counts: { ...none, "todo.next": 1, __done__: 1 }, lists,
      });
      expect(partial.columns["todo.next"]).toEqual({ count: "—", note: "Loading…", tone: "wait" });
      expect(partial.columns.__done__).toEqual({ count: "—", note: "Waiting for a list to load", tone: "wait" });
    });

    it("still reports a real failure elsewhere on the board, with its Retry", () => {
      const s = boardState({ connStatus: "ready", reads: { ...reads, "todo.backlog": "error" }, counts: none, lists });
      expect(s.columns["todo.backlog"]).toMatchObject({ note: "Couldn't read this column", retry: true });
      expect(s.columns["todo.next"].retry).toBeUndefined();
      expect(s.meta).toBe("some columns couldn't be read");
    });

    it("says nothing about a list that is loading but read fine, or a Done that read fine", () => {
      const s = boardState({ connStatus: "ready", reads: all("ok"), counts: { ...none, "todo.next": 2 }, lists });
      expect(s.columns["todo.next"]).toEqual({ count: 2, note: null, tone: null });
      expect(s.columns.__done__).toEqual({ count: 0, note: null, tone: null });
      expect(s.meta).toBe("drag cards between columns");
    });

    it("doesn't excuse Done's failure when no loading list failed — then it is a real one", () => {
      const s = boardState({ connStatus: "ready", reads: { ...all("ok"), __done__: "error" }, counts: none, lists });
      expect(s.columns.__done__).toMatchObject({ note: "Couldn't read this column", retry: true });
    });

    it("offline, the connection is the explanation, as before", () => {
      const s = boardState({ connStatus: "disconnected", reads, counts: { ...none, "todo.next": 3 }, lists });
      expect(s.columns["todo.next"]).toMatchObject({ note: "Couldn't refresh · may be out of date", retry: false });
      expect(s.meta).toBe("not connected · may be out of date");
    });
  });
});

describe("buildDescription", () => {
  it("round-trips through parseTags", () => {
    const built = buildDescription(["home", "urgent"], "fix the boiler");
    expect(parseTags(built)).toEqual({ tags: ["home", "urgent"], text: "fix the boiler" });
  });

  it("returns undefined rather than an empty string when there is nothing to say", () => {
    // undefined means "omit the field"; an empty string would overwrite a
    // description in Home Assistant with nothing.
    expect(buildDescription([], "")).toBeUndefined();
  });

  it("works with tags but no text, and text but no tags", () => {
    expect(buildDescription(["home"], "")).toBe("#home");
    expect(buildDescription([], "just a note")).toBe("just a note");
  });
});

describe("fmtDue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 4, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("says nothing when there is no due date", () => {
    expect(fmtDue(undefined)).toBe(null);
    expect(fmtDue(null)).toBe(null);
    expect(fmtDue("")).toBe(null);
  });

  it("never renders Invalid Date for a value it cannot parse", () => {
    for (const junk of ["unavailable", "banana", "2026-13-45", "not-a-date-at-all"]) {
      expect(fmtDue(junk)).toBe(null);
    }
  });

  it("names today and tomorrow for bare dates", () => {
    expect(fmtDue("2026-08-04")).toBe("today");
    expect(fmtDue("2026-08-05")).toBe("tomorrow");
  });

  it("calls a past date overdue", () => {
    expect(fmtDue("2026-08-03")).toBe("overdue");
    expect(fmtDue("2026-07-01")).toBe("overdue");
  });

  it("treats a bare date as due at the end of that day, not at midnight", () => {
    // It is midday on the 4th; a task due "2026-08-04" is not late yet.
    expect(fmtDue("2026-08-04")).toBe("today");
  });

  it("uses the time of day when the due value carries one", () => {
    expect(fmtDue("2026-08-04T09:00:00")).toBe("overdue"); // this morning
    expect(fmtDue("2026-08-04T18:00:00")).toBe("today"); // this evening
  });

  it("spells out anything further ahead", () => {
    expect(fmtDue("2026-08-12")).toMatch(/Wed/);
  });
});

describe("dueFields", () => {
  it("routes a bare date to due_date", () => {
    expect(dueFields("2026-08-04")).toEqual({ due_date: "2026-08-04" });
  });

  it("routes a timestamp to due_datetime", () => {
    expect(dueFields("2026-08-04T14:30:00+01:00")).toEqual({
      due_datetime: "2026-08-04T14:30:00+01:00",
    });
  });

  it("sends neither field when there is no due value", () => {
    expect(dueFields(undefined)).toEqual({});
    expect(dueFields(null)).toEqual({});
    expect(dueFields("")).toEqual({});
  });

  it("agrees with fmtDue about which values carry a time", () => {
    // Both decide on the same length test; if one changes, a move drops a due
    // time or throws on the re-add.
    expect(Object.keys(dueFields("2026-08-04"))).toEqual(["due_date"]);
    expect(Object.keys(dueFields("2026-08-04T00:00:00"))).toEqual(["due_datetime"]);
  });
});
