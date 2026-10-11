// Pure model of the review profile editor (M4). No DOM access, so bun test runs it.
import { MAX_NOTE, MAX_PROFILES, type ProfileInput } from "../../shared/dto";

// The inline limits of profileInput in src/shared/dto.ts. tests/ui/profiles.test.ts pins them.
export const LIMITS = { profiles: MAX_PROFILES, id: 40, name: 60, note: 200, prompt: MAX_NOTE, minTurns: 2, maxTurns: 200 } as const;

// D6: a new profile starts as a review profile with 40 turns and the documentation servers.
const NEW_TURNS = "40";

// key: a stable React key, so a moved profile keeps its DOM nodes. id: the saved ID, or null for a new profile.
// maxTurns: the text of the field.
export type Draft = {
  key: number;
  id: string | null;
  name: string;
  note: string;
  prompt: string;
  explain: boolean;
  docs: boolean;
  maxTurns: string;
};

let lastKey = 0;

export const toDrafts = (profiles: ProfileInput[]): Draft[] =>
  profiles.map((p) => ({ key: ++lastKey, ...p, maxTurns: String(p.maxTurns) }));

// The profileInput ID pattern is [a-z0-9-]{1,40}.
export function slug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, LIMITS.id)
    .replace(/^-+|-+$/g, "");
  return s || "profile";
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    const tail = `-${n}`;
    id = `${base.slice(0, LIMITS.id - tail.length).replace(/-+$/, "")}${tail}`;
  }
  return id;
}

// A saved profile keeps its ID through a rename. A new profile takes the slug of its name, and saved IDs come first.
export function toProfiles(list: Draft[]): ProfileInput[] {
  const taken = new Set(list.flatMap((d) => (d.id ? [d.id] : [])));
  return list.map((d) => {
    const id = d.id ?? uniqueId(slug(d.name), taken);
    taken.add(id);
    const turns = d.maxTurns.trim();
    return {
      id,
      name: d.name.trim(),
      note: d.note.trim(),
      prompt: d.prompt.trim(),
      explain: d.explain,
      docs: d.docs,
      maxTurns: turns ? Number(turns) : Number.NaN,
    };
  });
}

const FIELDS = ["id", "name", "note", "prompt", "explain", "docs", "maxTurns"] as const;

export const sameProfiles = (a: ProfileInput[], b: ProfileInput[]) =>
  a.length === b.length &&
  a.every((p, i) => {
    const o = b[i];
    return !!o && FIELDS.every((f) => p[f] === o[f]);
  });

export type Field = "name" | "note" | "prompt" | "maxTurns";
export type Problems = Partial<Record<Field, string>>;

// The profileInput rules: the server trims each text before it checks the length.
export function problems(d: Draft): Problems {
  const out: Problems = {};
  const name = d.name.trim();
  const prompt = d.prompt.trim();
  const turns = d.maxTurns.trim() ? Number(d.maxTurns) : Number.NaN;
  if (!name) out.name = "Enter a name.";
  else if (name.length > LIMITS.name) out.name = `Use ${LIMITS.name} characters or fewer for the name.`;
  if (d.note.trim().length > LIMITS.note) out.note = `Use ${LIMITS.note} characters or fewer for the note.`;
  if (!prompt) out.prompt = "Enter a prompt.";
  else if (prompt.length > LIMITS.prompt) out.prompt = `Use ${LIMITS.prompt.toLocaleString("en")} characters or fewer for the prompt.`;
  if (!Number.isInteger(turns) || turns < LIMITS.minTurns || turns > LIMITS.maxTurns)
    out.maxTurns = `Enter a turn cap from ${LIMITS.minTurns} to ${LIMITS.maxTurns}.`;
  return out;
}

export const allValid = (list: Draft[]) =>
  list.length >= 1 && list.length <= LIMITS.profiles && list.every((d) => Object.keys(problems(d)).length === 0);

export type Edit = Partial<Pick<Draft, "name" | "note" | "prompt" | "explain" | "docs" | "maxTurns">>;

export type Change =
  | { act: "add" }
  | { act: "remove"; i: number }
  | { act: "move"; i: number; d: -1 | 1 }
  | { act: "edit"; i: number; patch: Edit };

export function change(list: Draft[], c: Change): Draft[] {
  switch (c.act) {
    case "add":
      return list.length >= LIMITS.profiles
        ? list
        : [...list, { key: ++lastKey, id: null, name: "", note: "", prompt: "", explain: false, docs: true, maxTurns: NEW_TURNS }];
    case "remove":
      // The server needs at least one profile.
      return list.length <= 1 ? list : list.filter((_, i) => i !== c.i);
    case "move": {
      const j = c.i + c.d;
      const d = list[c.i];
      if (!d || j < 0 || j >= list.length) return list;
      const out = list.filter((_, i) => i !== c.i);
      out.splice(j, 0, d);
      return out;
    }
    case "edit":
      return list.map((d, i) => (i === c.i ? { ...d, ...c.patch } : d));
  }
}

// DOM ids of the editor controls.
export type Part = "name" | "note" | "prompt" | "turns" | "explain" | "docs" | "up" | "down" | "remove" | `${Field}-error`;
export const profileId = (i: number, part: Part) => `profile-${i}-${part}`;
export const ADD_ID = "profile-add";

// The control that keeps the place after a change. n: the profile count after it.
export function focusAfter(c: Change, n: number): string | null {
  switch (c.act) {
    case "add":
      return profileId(n - 1, "name");
    case "remove":
      // The remove button of the last profile is disabled.
      return n > 1 ? profileId(Math.min(c.i, n - 1), "remove") : ADD_ID;
    case "move": {
      const j = c.i + c.d;
      // The button in the same direction is disabled at the end of the list.
      const end = c.d < 0 ? j === 0 : j === n - 1;
      return profileId(j, c.d < 0 !== end ? "up" : "down");
    }
    default:
      return null;
  }
}

// Words for a profile in labels. A new profile can have no name yet.
export const profileLabel = (d: Draft, i: number) => d.name.trim() || `profile ${i + 1}`;
