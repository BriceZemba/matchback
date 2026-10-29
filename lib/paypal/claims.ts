import { getDb, isDuplicateKey, now } from "@/lib/db";

// The claim row every PayPal write takes before the SDK call (paypal-plan.md 1b.1, DUPLICATE CLAIMS).
// The same key is sent to PayPal as PayPal-Request-Id, so PayPal also joins a re-send.

export type ClaimRow = { claim_key: string; op: string; state: "claimed" | "done" | "unknown"; result_json: string | null };

/** Insert the claim. Returns null when this caller owns it, or the existing row when another caller does. */
export async function takeClaim(claimKey: string, op: string): Promise<ClaimRow | null> {
  const db = getDb();
  try {
    await db.run("INSERT INTO paypal_writes (claim_key, op, state, created_at) VALUES (?, ?, 'claimed', ?)", claimKey, op, now());
    return null;
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    return await db.get("SELECT claim_key, op, state, result_json FROM paypal_writes WHERE claim_key = ?", claimKey) as ClaimRow;
  }
}

export async function finishClaim(claimKey: string, result: unknown) {
  await getDb().run("UPDATE paypal_writes SET state = 'done', result_json = ? WHERE claim_key = ?", JSON.stringify(result), claimKey);
}

export async function markUnknown(claimKey: string) {
  await getDb().run("UPDATE paypal_writes SET state = 'unknown' WHERE claim_key = ?", claimKey);
}

/** Release a claim when PayPal refused the call or nothing was sent, so a corrected attempt is not blocked. */
export async function releaseClaim(claimKey: string) {
  await getDb().run("DELETE FROM paypal_writes WHERE claim_key = ?", claimKey);
}
