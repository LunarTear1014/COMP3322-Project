// Preserve microseconds for half-open database comparisons even though Date
// itself has millisecond precision.
export function parseUtcInstant(value) {
  if (typeof value !== "string") return null;
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match) return null;
  const ms=Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,19)!==match[1]) return null;
  const fraction=(match[2] || "").padEnd(6,"0");
  return { micros:BigInt(ms)*1000n+BigInt(fraction), sql:`${match[1].replace("T"," ")}.${fraction}`, iso:value };
}

export function parseUtcRange(from,to,maxDays) {
  const start=parseUtcInstant(from),end=parseUtcInstant(to);
  if (!start || !end || end.micros <= start.micros || end.micros-start.micros > BigInt(maxDays)*86400000000n) return null;
  return { start,end };
}
