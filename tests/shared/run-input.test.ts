// The profile option of the run inputs: a profile for one run only. The route checks that the settings list the ID.
import { describe, expect, test } from "bun:test";
import { askInput, fixRunInput, replyRunInput, reviewRunInput } from "../../src/shared/dto";

const inputs = [
  ["review", reviewRunInput, {}],
  ["reply", replyRunInput, { threads: [101] }],
  ["fix", fixRunInput, { threads: [101] }],
  ["ask", askInput, { question: "Why?" }],
] as const;

describe.each(inputs)("%s run input", (_, schema, base) => {
  test("the profile is optional, and a valid ID passes as given", () => {
    expect(schema.safeParse(base).data as unknown).toEqual(base);
    expect(schema.safeParse({ ...base, profile: "security" }).data as unknown).toEqual({ ...base, profile: "security" });
  });

  test("a profile ID outside the profile ID form fails on the profile field", () => {
    for (const profile of ["", "Security", "a b", "x".repeat(41), 7, null]) {
      const r = schema.safeParse({ ...base, profile });
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.path[0])).toEqual(["profile"]);
    }
  });
});
