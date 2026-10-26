import type { CSSProperties, ReactNode } from "react";

// Clickable legend shared by every chart: each item shows or hides its series.
// The chart owns which items are hidden and any rule about what must stay on.

export interface LegendItem {
  key: string;
  label: string;
  // A colour for the standard square swatch, or a custom swatch element.
  swatch: string | ReactNode;
  // Shown as off and not clickable, with the reason as its tooltip.
  unavailable?: string;
}

export function ChartLegend({ items, hidden, onToggle, style }: {
  items: LegendItem[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  style?: CSSProperties;
}) {
  return (
    <div className="legend interactive" role="group" aria-label="Show or hide series" style={style}>
      {items.map(item => {
        const on = !item.unavailable && !hidden.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            className="legend-item"
            aria-pressed={on}
            disabled={!!item.unavailable}
            title={item.unavailable ?? (on ? `Hide ${item.label}` : `Show ${item.label}`)}
            onClick={() => onToggle(item.key)}
          >
            {typeof item.swatch === "string" ? <i className="sw" style={{ background: item.swatch }} /> : item.swatch}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
