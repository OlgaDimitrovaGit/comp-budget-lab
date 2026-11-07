export const MINUS = "−";
export function eurM(v: number, opts: { sign?: boolean } = {}) {
  const r = Math.round((v / 1e6) * 100) / 100;
  const abs = Math.abs(v / 1e6).toFixed(2);
  if (!opts.sign) return `${v < 0 ? MINUS : ""}€${abs}M`;
  if (v === 0) return `€${abs}M`;
  return `${v < 0 ? MINUS : "+"}€${abs}M`;
  void r;
}
export function eurK(v: number) {
  const k = Math.round(Math.abs(v) / 1000).toLocaleString("en-US");
  return `${v < 0 ? MINUS : ""}€${k}k`;
}
export const m2 = (v: number) => (v / 1e6).toFixed(2);
