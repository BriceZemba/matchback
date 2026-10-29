// Money is kept as integer cents internally and as PayPal's decimal strings ("12.34") on the wire.
// Never round-trip through floating point.

export function toCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`not a money amount: ${JSON.stringify(value)}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function fromCents(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
