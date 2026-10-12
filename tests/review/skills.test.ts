import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../../src/server/config";
import { profileRevision, reviewerAgent, SHIPPED_PROFILES, withSkills } from "../../src/server/review/catalog";
import { buildPrompt, type PromptInput } from "../../src/server/review/prompt";
import { copySkills, discoverSkills, MAX_SKILL_BYTES, MAX_SKILL_FILES, skillDto } from "../../src/server/review/skills";
import { profileInput } from "../../src/shared/dto";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `rl-skills-${tag}-`));
  dirs.push(d);
  return d;
};
const write = (path: string, text: string | Uint8Array) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const skill = (dir: string, front: string, body = "Body.\n") => write(join(dir, "SKILL.md"), `---\n${front}\n---\n${body}`);
const json = (path: string, v: unknown) => write(path, JSON.stringify(v));

// A config folder with a user skill, an enabled plugin, a disabled plugin, and a plugin installed only for a project.
function config() {
  const c = temp("config");
  skill(join(c, "skills", "review-rules"), 'name: Review rules\ndescription: "Checks: the house rules."');
  skill(join(c, "skills", "folded"), "description: >\n  One\n  line.");
  write(join(c, "skills", "no-skill-md", "README.md"), "x");
  write(join(c, "skills", "bad name!", "SKILL.md"), "x");
  write(join(c, "skills", "plain", "SKILL.md"), "No front matter.\n");
  const on = join(c, "plugins", "cache", "m", "tools", "1.0.0");
  const off = join(c, "plugins", "cache", "m", "off", "2.0.0");
  const local = join(c, "plugins", "cache", "m", "local", "3.0.0");
  skill(join(on, "skills", "lint"), "name: lint\ndescription: Lint rules.");
  skill(join(off, "skills", "hidden"), "name: hidden");
  skill(join(local, "skills", "project"), "name: project");
  json(join(c, "settings.json"), { enabledPlugins: { "tools@m": true, "off@m": false, "local@m": true } });
  json(join(c, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "tools@m": [
        { scope: "local", projectPath: "/elsewhere", installPath: join(c, "nowhere"), version: "0.1.0" },
        { scope: "user", installPath: on, version: "1.0.0" },
      ],
      "off@m": [{ scope: "user", installPath: off, version: "2.0.0" }],
      "local@m": [{ scope: "project", projectPath: "/elsewhere", installPath: local, version: "3.0.0" }],
    },
  });
  return c;
}

describe("skill discovery", () => {
  test("lists user skills and the skills of enabled user-scope plugins", () => {
    expect(discoverSkills(config()).map(skillDto)).toEqual([
      { id: "folded", name: "folded", description: "One line.", source: "user" },
      { id: "plain", name: "plain", description: "", source: "user" },
      { id: "review-rules", name: "Review rules", description: "Checks: the house rules.", source: "user" },
      { id: "tools:lint", name: "lint", description: "Lint rules.", source: "plugin", version: "1.0.0" },
    ]);
  });

  test("bad JSON and missing files give fewer skills, never an error", () => {
    const c = config();
    write(join(c, "settings.json"), "{ not json");
    expect(discoverSkills(c).map((s) => s.id)).toEqual(["folded", "plain", "review-rules"]);
    json(join(c, "settings.json"), { enabledPlugins: { "tools@m": true } });
    write(join(c, "plugins", "installed_plugins.json"), "[");
    expect(discoverSkills(c).map((s) => s.id)).toEqual(["folded", "plain", "review-rules"]);
    json(join(c, "plugins", "installed_plugins.json"), { plugins: { "tools@m": "wrong" } });
    expect(discoverSkills(c).map((s) => s.id)).toEqual(["folded", "plain", "review-rules"]);
    expect(discoverSkills(join(c, "absent"))).toEqual([]);
  });

  test("every discovered ID passes the profile skill pattern", () => {
    for (const s of discoverSkills(config())) expect(profileInput.shape.skills.safeParse([s.id]).success, s.id).toBe(true);
  });
});

describe("skill copy", () => {
  test("copies text files and skips links, binaries, hidden entries, and files past the caps", () => {
    const c = temp("caps");
    const src = join(c, "skills", "big");
    skill(src, "name: big");
    write(join(src, "docs", "guide.md"), "Guide.\n");
    write(join(src, "image.png"), "not really a png");
    write(join(src, "blob.txt"), new Uint8Array([65, 0, 66]));
    write(join(src, ".git", "config"), "x");
    write(join(src, "huge.md"), "x".repeat(MAX_SKILL_BYTES));
    for (let i = 0; i < MAX_SKILL_FILES + 5; i++) write(join(src, "many", `f${String(i).padStart(3, "0")}.md`), "m");
    const outside = temp("outside");
    write(join(outside, "secret.md"), "SECRET");
    // A junction needs no admin right on Windows.
    symlinkSync(outside, join(src, "escape"), process.platform === "win32" ? "junction" : "dir");
    // A file link needs an admin right or developer mode on Windows.
    try {
      symlinkSync(join(outside, "secret.md"), join(src, "linked.md"), "file");
    } catch {}

    const dest = join(temp("dest"), "skills");
    const r = copySkills(["big"], dest, c);
    expect(r.gaps).toEqual([]);
    const [one] = r.copied;
    expect(one).toMatchObject({ id: "big", version: null, folder: "big", files: MAX_SKILL_FILES });
    const to = join(dest, "big");
    expect(existsSync(join(to, "SKILL.md"))).toBe(true);
    expect(existsSync(join(to, "docs", "guide.md"))).toBe(true);
    for (const gone of ["image.png", "blob.txt", ".git", "huge.md", "escape", "linked.md"])
      expect(existsSync(join(to, gone)), gone).toBe(false);
    // SKILL.md and docs/guide.md come first, so the many/ folder fills the rest of the file cap.
    expect(readdirSync(join(to, "many"))).toHaveLength(MAX_SKILL_FILES - 2);
    expect(one?.bytes).toBeLessThanOrEqual(MAX_SKILL_BYTES);
    expect(one?.skipped).toBeGreaterThanOrEqual(8);
  });

  test("a missing skill or a SKILL.md past the size cap is a gap; plugin skills get their own folder", () => {
    const c = config();
    skill(join(c, "skills", "fat"), "name: fat", "y".repeat(MAX_SKILL_BYTES));
    const dest = join(temp("dest"), "skills");
    const r = copySkills(["tools:lint", "gone", "fat", "review-rules"], dest, c);
    expect(r.copied.map((s) => [s.id, s.folder, s.version])).toEqual([
      ["tools:lint", "tools+lint", "1.0.0"],
      ["review-rules", "review-rules", null],
    ]);
    expect(r.gaps).toEqual(["Skill gone: not found", `Skill fat: SKILL.md is over ${MAX_SKILL_BYTES} bytes or not a text file`]);
    expect(readdirSync(dest).sort()).toEqual(["review-rules", "tools+lint"]);
  });

  test("no listed skill copies nothing", () => {
    const dest = join(temp("dest"), "skills");
    expect(copySkills([], dest, config())).toEqual({ copied: [], gaps: [] });
    expect(existsSync(dest)).toBe(false);
  });
});

describe("skill prompts and profiles", () => {
  const general = SHIPPED_PROFILES[0] as (typeof SHIPPED_PROFILES)[number];
  const input: PromptInput = {
    mergeBase: "a".repeat(40),
    head: "b".repeat(40),
    note: "NOTE",
    profile: general,
    pr: { project: "P", repo: "r", prId: 1, webUrl: null },
    tasks: [],
    taskFile: false,
    attachments: false,
  };

  test("the prompt names each skill folder before the user instructions", () => {
    const text = buildPrompt({ ...input, skills: ["review-rules", "tools+lint"] });
    expect(text).toContain(
      [
        "# Skills",
        "",
        "The user chose these skills: ./skills/review-rules/SKILL.md, ./skills/tools+lint/SKILL.md.",
        "Read each SKILL.md first and follow it. Read its other files when it tells you to.",
        "Skill scripts cannot run. The rules above stay in force, and your result must still use the required output format.",
        "",
        "# Your instructions",
      ].join("\n"),
    );
    expect(buildPrompt(input)).not.toContain("# Skills");
    expect(buildPrompt({ ...input, skills: [] })).not.toContain("# Skills");
  });

  test("the reviewer subagent gets the same pointer", () => {
    const a = reviewerAgent(general);
    expect(withSkills(a, [])).toBe(a);
    const p = withSkills(a, ["x"]).prompt;
    expect(p.startsWith(`${a.prompt}\nThe user chose these skills: ./skills/x/SKILL.md.`)).toBe(true);
    expect(p).toContain("Skill scripts cannot run.");
  });

  test("a saved profile without skills reads as no skills and keeps its revision", () => {
    const dir = temp("cfg");
    const { skills, ...old } = { ...general, prompt: "Mine." };
    json(join(dir, "config.json"), { baseUrl: "https://example.test", userSlug: "me", notifications: false, profiles: [old] });
    const read = readConfig(dir)?.profiles?.[0];
    expect(read).toEqual({ ...old, skills: [] });
    const before = createHash("sha256")
      .update(JSON.stringify(old, ["id", "name", "note", "prompt", "explain", "docs", "maxTurns"]))
      .digest("hex");
    expect(profileRevision(read as typeof general)).toBe(before);
    expect(profileRevision({ ...(read as typeof general), skills: ["x"] })).not.toBe(before);
  });

  test("the profile schema dedupes skills and refuses bad IDs", () => {
    expect(profileInput.parse({ ...general, skills: ["a", "p:b", "a"] }).skills).toEqual(["a", "p:b"]);
    for (const bad of ["../x", "a/b", "a:b:c", ":x", "", "a b"])
      expect(profileInput.safeParse({ ...general, skills: [bad] }).success, bad).toBe(false);
    expect(profileInput.safeParse({ ...general, skills: Array.from({ length: 21 }, (_, i) => `s${i}`) }).success).toBe(false);
  });
});
