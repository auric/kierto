import { describe, expect, test } from "bun:test";
import { parseSignatureHeader } from "../../src/webhooks/header";

const hex = (c: string) => c.repeat(64);

describe("parseSignatureHeader", () => {
  test("reads the time in milliseconds and keeps the sent value", () => {
    expect(parseSignatureHeader(`t=1700000000,v1=${hex("a")}`)).toEqual({ t: 1_700_000_000_000, timestamp: "1700000000", v1: [hex("a")] });
  });

  test("keeps each v1 value during a secret rotation", () => {
    expect(parseSignatureHeader(`t=1,v1=${hex("a")}, v1=${hex("b")}`)?.v1).toEqual([hex("a"), hex("b")]);
  });

  test("ignores unknown keys and malformed values", () => {
    expect(parseSignatureHeader(`t=1,v0=${hex("c")},v1=${hex("a")},v1=xyz`)?.v1).toEqual([hex("a")]);
  });

  test("refuses a header without a time or without a valid signature", () => {
    expect(parseSignatureHeader(undefined)).toBeNull();
    expect(parseSignatureHeader(`v1=${hex("a")}`)).toBeNull();
    expect(parseSignatureHeader("t=1,v1=abc")).toBeNull();
    expect(parseSignatureHeader(`t=-1,v1=${hex("a")}`)).toBeNull();
    expect(parseSignatureHeader(`t=1,v1=${hex("A")}`)).toBeNull();
  });
});
