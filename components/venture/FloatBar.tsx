// Float, drawn. OutcomeBar: one outcome's float range on the 0–1 wear scale,
// wear grades as bands, where this contract lands, and the next grade boundary
// (the cliff). BudgetBar: how much of the contract's float budget the inputs use.
const GRADES = [
  { max: 0.07, label: "FN" },
  { max: 0.15, label: "MW" },
  { max: 0.38, label: "FT" },
  { max: 0.45, label: "WW" },
  { max: 1, label: "BS" },
];

export function OutcomeBar({ float, min, max }: { float: number; min: number; max: number }) {
  const W = 160, H = 14;
  const x = (f: number) => (f * W).toFixed(2);
  const cliff = GRADES.map((g) => g.max).find((b) => b > float && b < max);
  let lo = 0;
  return (
    <svg className="vx-fbar" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`lands at ${float.toFixed(4)}${cliff ? `, next grade at ${cliff}` : ""}`}>
      {GRADES.map((g, i) => {
        const r = <rect key={g.label} x={x(lo)} y={5} width={((g.max - lo) * W).toFixed(2)} height={4} fill={i % 2 ? "var(--surface-2)" : "var(--surface-line)"} />;
        lo = g.max;
        return r;
      })}
      <rect x={x(min)} y={4} width={((max - min) * W).toFixed(2)} height={6} fill="none" stroke="var(--fg-faint)" strokeWidth={1} />
      {cliff != null && <line x1={x(cliff)} x2={x(cliff)} y1={1} y2={13} stroke="var(--amber)" strokeWidth={1} />}
      <circle cx={x(float)} cy={7} r={3} fill="var(--green)" />
    </svg>
  );
}

export function BudgetBar({ sum, max, size }: { sum: number; max: number; size: number }) {
  const used = Math.min(1, sum / max);
  const margin = max - sum;
  const tone = margin < 0.02 ? "var(--amber)" : "var(--green-dim)";
  return (
    <div className="vx-budget" title={`Σ adjusted floats ${sum.toFixed(4)} of ${max.toFixed(4)}`}>
      <div className="vx-budget__track">
        <div className="vx-budget__fill" style={{ width: `${used * 100}%`, background: tone }} />
      </div>
      <span className="vx-budget__lbl">
        {sum.toFixed(3)} / {max.toFixed(3)} · {margin < 0.0005 ? "no room" : `${margin.toFixed(3)} to spare`} across {size} inputs
      </span>
    </div>
  );
}
