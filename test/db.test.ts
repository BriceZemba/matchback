import { describe, expect, it } from "vitest";
import { isDuplicateKey, toPostgresPlaceholders } from "@/lib/db";

describe("database helpers", () => {
  it("numbers placeholders for Postgres and leaves quoted text alone", () => {
    expect(toPostgresPlaceholders("SELECT 1 FROM claims WHERE id = ? AND status IN ('a?', 'b') AND order_id = ?")).toBe(
      "SELECT 1 FROM claims WHERE id = $1 AND status IN ('a?', 'b') AND order_id = $2",
    );
  });
  it("recognises a duplicate key from SQLite and from Postgres", () => {
    expect(isDuplicateKey({ errcode: 1555 })).toBe(true);
    expect(isDuplicateKey({ errcode: 2067 })).toBe(true);
    expect(isDuplicateKey({ code: "23505" })).toBe(true);
    expect(isDuplicateKey({ code: "23503" })).toBe(false);
    expect(isDuplicateKey(new Error("UNIQUE constraint failed"))).toBe(false);
  });
});
