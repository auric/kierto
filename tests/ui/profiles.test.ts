import { describe, expect, test } from "bun:test";
import { MAX_NOTE, MAX_PROFILES, type ProfileInput, profileInput, profileList } from "../../src/shared/dto";
import {
  ADD_ID,
  allValid,
  change,
  type Draft,
  focusAfter,
  LIMITS,
  problems,
  profileId,
  sameProfiles,
  slug,
  toDrafts,
  toggleSkill,
  toProfiles,
} from "../../src/web/settings/profiles";

const p = (id: string, name: string, o: Partial<ProfileInput> = {}): ProfileInput => ({
  id,
  name,
  note: `${name} note`,
  prompt: `Check ${name}.`,
  explain: false,
  docs: true,
  maxTurns: 40,
  skills: [],
  ...o,
});
const SAVED = [p("general", "General"), p("security", "Security"), p("explain", "Explain", { explain: true, docs: false, maxTurns: 12 })];

const added = (list: Draft[], name: string, prompt = "Look.") => {
  const next = change(list, { act: "add" });
  return change(next, { act: "edit", i: next.length - 1, patch: { name, prompt } });
};
const ids = (list: Draft[]) => toProfiles(list).map((x) => x.id);

describe("profile editor model", () => {
  test("saved profiles become drafts and back without loss", () => {
    const d = toDrafts(SAVED);
    expect(toProfiles(d)).toEqual(SAVED);
    expect(sameProfiles(toProfiles(d), SAVED)).toBe(true);
    expect(d.map((x) => x.maxTurns)).toEqual(["40", "40", "12"]);
    expect(new Set(d.map((x) => x.key)).size).toBe(3);
  });

  test("a saved profile keeps its ID through a rename; a new one takes a unique slug of its name", () => {
    let d = change(toDrafts(SAVED), { act: "edit", i: 0, patch: { name: "Correctness" } });
    expect(ids(d)[0]).toBe("general");
    d = added(d, "Threat Model!");
    // The saved IDs come first, so a new "General" does not take the ID of the renamed profile.
    d = added(d, "General");
    d = added(d, "Perf");
    d = added(d, "Perf");
    expect(ids(d)).toEqual(["general", "security", "explain", "threat-model", "general-2", "perf", "perf-2"]);
    expect(profileList.safeParse(toProfiles(d)).success).toBe(true);
  });

  test("slugs fit the server ID pattern for any name", () => {
    expect(slug("Überprüfung der API")).toBe("uberprufung-der-api");
    expect(slug("  --Over-engineering--  ")).toBe("over-engineering");
    expect(slug("Код ревью")).toBe("profile");
    expect(slug("🤖")).toBe("profile");
    const long = `${"a".repeat(LIMITS.id - 1)} b`;
    expect(slug(long)).toBe("a".repeat(LIMITS.id - 1));
    let d = toDrafts([p("x", "X")]);
    for (let i = 0; i < 12; i++) d = added(d, "Y".repeat(70));
    const out = ids(d);
    expect(new Set(out).size).toBe(out.length);
    for (const id of out) expect(profileInput.shape.id.safeParse(id).success).toBe(true);
    expect(out.at(-1)).toBe(`${"y".repeat(LIMITS.id - 3)}-12`);
  });

  test("remove keeps one profile, add stops at the limit, move keeps the keys", () => {
    const d = toDrafts(SAVED);
    expect(ids(change(d, { act: "remove", i: 1 }))).toEqual(["general", "explain"]);
    const one = toDrafts([p("only", "Only")]);
    expect(change(one, { act: "remove", i: 0 })).toBe(one);
    let full = d;
    for (let i = 0; i < 30; i++) full = change(full, { act: "add" });
    expect(full).toHaveLength(MAX_PROFILES);
    const moved = change(d, { act: "move", i: 2, d: -1 });
    expect(ids(moved)).toEqual(["general", "explain", "security"]);
    expect(moved.map((x) => x.key)).toEqual([0, 2, 1].map((i) => d[i]?.key ?? -1));
    expect(change(d, { act: "move", i: 0, d: -1 })).toBe(d);
    expect(change(d, { act: "move", i: 2, d: 1 })).toBe(d);
    // A new profile starts as a review profile: no name, no prompt, 100 turns, documentation on.
    expect(change(d, { act: "add" }).at(-1)).toMatchObject({ id: null, name: "", prompt: "", explain: false, docs: true, maxTurns: "100" });
  });

  test("focus keeps the place after each change", () => {
    expect(focusAfter({ act: "add" }, 4)).toBe(profileId(3, "name"));
    expect(focusAfter({ act: "remove", i: 2 }, 2)).toBe(profileId(1, "remove"));
    expect(focusAfter({ act: "remove", i: 0 }, 2)).toBe(profileId(0, "remove"));
    // One profile is left, and its remove button is disabled.
    expect(focusAfter({ act: "remove", i: 0 }, 1)).toBe(ADD_ID);
    expect(focusAfter({ act: "move", i: 2, d: -1 }, 3)).toBe(profileId(1, "up"));
    expect(focusAfter({ act: "move", i: 1, d: -1 }, 3)).toBe(profileId(0, "down"));
    expect(focusAfter({ act: "move", i: 1, d: 1 }, 3)).toBe(profileId(2, "up"));
    expect(focusAfter({ act: "edit", i: 0, patch: {} }, 3)).toBeNull();
  });

  test("problems read as text", () => {
    const [base] = toDrafts([p("general", "General")]) as [Draft];
    expect(problems(base)).toEqual({});
    expect(problems({ ...base, name: "  ", prompt: "", maxTurns: "" })).toEqual({
      name: "Enter a name.",
      prompt: "Enter a prompt.",
      maxTurns: "Enter a turn cap from 2 to 200.",
    });
    expect(problems({ ...base, name: "n".repeat(61) }).name).toBe("Use 60 characters or fewer for the name.");
    expect(problems({ ...base, note: "n".repeat(201) }).note).toBe("Use 200 characters or fewer for the note.");
    expect(problems({ ...base, prompt: "p".repeat(MAX_NOTE + 1) }).prompt).toBe("Use 20,000 characters or fewer for the prompt.");
  });

  test("the client accepts exactly what the server schema accepts", () => {
    const [base] = toDrafts([p("general", "General")]) as [Draft];
    const cases: Partial<Draft>[] = [
      {},
      { name: "" },
      { name: "   " },
      { name: ` ${"n".repeat(60)} ` },
      { name: "n".repeat(61) },
      { note: "" },
      { note: ` ${"n".repeat(200)} ` },
      { note: "n".repeat(201) },
      { prompt: " \n " },
      { prompt: "p".repeat(MAX_NOTE) },
      { prompt: "p".repeat(MAX_NOTE + 1) },
      ...["1", "2", "200", "201", "2.5", "", " 12 ", "abc", "-3", "1e2"].map((maxTurns) => ({ maxTurns })),
    ];
    for (const c of cases) {
      const d = { ...base, ...c };
      expect([c, allValid([d])]).toEqual([c, profileList.safeParse(toProfiles([d])).success]);
    }
    expect(allValid([])).toBe(profileList.safeParse([]).success);
  });

  test("dirty compares the saved form: trimmed text, numbers, and order", () => {
    const d = toDrafts(SAVED);
    const dirty = (list: Draft[]) => !sameProfiles(toProfiles(list), SAVED);
    expect(dirty(d)).toBe(false);
    expect(dirty(change(d, { act: "edit", i: 0, patch: { name: " General  " } }))).toBe(false);
    expect(dirty(change(d, { act: "edit", i: 0, patch: { maxTurns: "040" } }))).toBe(false);
    expect(dirty(change(d, { act: "edit", i: 0, patch: { docs: false } }))).toBe(true);
    expect(dirty(change(d, { act: "edit", i: 2, patch: { prompt: "Other." } }))).toBe(true);
    const moved = change(d, { act: "move", i: 0, d: 1 });
    expect(dirty(moved)).toBe(true);
    expect(dirty(change(moved, { act: "move", i: 1, d: -1 }))).toBe(false);
    expect(dirty(change(d, { act: "remove", i: 1 }))).toBe(true);
    expect(dirty(change(d, { act: "add" }))).toBe(true);
    const picked = change(d, { act: "edit", i: 0, patch: { skills: toggleSkill([], "p:x", true) } });
    expect(dirty(picked)).toBe(true);
    expect(toProfiles(picked)[0]?.skills).toEqual(["p:x"]);
    expect(dirty(change(picked, { act: "edit", i: 0, patch: { skills: toggleSkill(["p:x"], "p:x", false) } }))).toBe(false);
  });

  test("toggleSkill adds at the end once and removes every copy", () => {
    expect(toggleSkill(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSkill(["a", "b"], "a", true)).toEqual(["a", "b"]);
    expect(toggleSkill(["a", "b"], "a", false)).toEqual(["b"]);
  });

  test("the limits match the shared request schema", () => {
    expect(LIMITS.profiles).toBe(MAX_PROFILES);
    expect(LIMITS.prompt).toBe(MAX_NOTE);
    const ok = (o: Partial<ProfileInput>) => profileInput.safeParse(p("x", "X", o)).success;
    expect(ok({ id: "a".repeat(LIMITS.id) })).toBe(true);
    expect(ok({ id: "a".repeat(LIMITS.id + 1) })).toBe(false);
    expect(ok({ name: "n".repeat(LIMITS.name) })).toBe(true);
    expect(ok({ name: "n".repeat(LIMITS.name + 1) })).toBe(false);
    expect(ok({ note: "n".repeat(LIMITS.note) })).toBe(true);
    expect(ok({ note: "n".repeat(LIMITS.note + 1) })).toBe(false);
    expect(ok({ maxTurns: LIMITS.minTurns })).toBe(true);
    expect(ok({ maxTurns: LIMITS.minTurns - 1 })).toBe(false);
    expect(ok({ maxTurns: LIMITS.maxTurns })).toBe(true);
    expect(ok({ maxTurns: LIMITS.maxTurns + 1 })).toBe(false);
    expect(ok({ skills: Array.from({ length: LIMITS.skills }, (_, i) => `s${i}`) })).toBe(true);
    expect(ok({ skills: Array.from({ length: LIMITS.skills + 1 }, (_, i) => `s${i}`) })).toBe(false);
  });
});
