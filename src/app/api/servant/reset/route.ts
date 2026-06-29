// [B3] Hub read-only lockdown (2026-06-28): the POST write surface ("Reset report"
// → set_servant_reset.py, marked SERVANT findings handled on the VM LIVE db over
// ssh) was removed. This path is now read-only — it 410s on GET to document the
// removal and 405s on a write verb. Server-side kill; UI removal is B1/B2.
export function GET() {
  return new Response(null, { status: 410 });
}
