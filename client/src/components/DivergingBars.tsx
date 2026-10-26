import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { tone } from "../lib/format";

// Horizontal bars from a centre line: losses to the left, gains to the right,
// all on one scale. Used for "where returns come from" and "why it moved".

export interface DivergingRow {
  id: string;
  label: string;
  value: number;
  // Text after the amount, e.g. the percentage move.
  note?: ReactNode;
  href?: string;
}

export function DivergingBars({ rows, format }: { rows: DivergingRow[]; format: (value: number) => string }) {
  const largest = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  // All gains or all losses: no centre line, bars use the full width.
  const oneSided = rows.every(row => row.value >= 0) || rows.every(row => row.value <= 0);

  return (
    <div className={`diverging${oneSided ? " one-sided" : ""}`}>
      {rows.map(row => {
        const width = `${(Math.abs(row.value) / largest) * 100}%`;
        return (
          <div className="row-d" key={row.id}>
            {row.href
              ? <Link to={row.href} className="label" title={row.label}>{row.label}</Link>
              : <span className="label" title={row.label}>{row.label}</span>}
            {oneSided
              ? <span className={row.value < 0 ? "bar neg-bar" : "bar pos-bar"}><span style={{ width }} /></span>
              : (
                <>
                  <span className="neg">{row.value < 0 && <span style={{ width }} />}</span>
                  <span className="pos">{row.value > 0 && <span style={{ width }} />}</span>
                </>
              )}
            <span className={`amt ${tone(row.value)}`}>
              {format(row.value)}
              {row.note && <span className="note">{row.note}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
