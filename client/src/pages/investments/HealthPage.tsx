import { useState } from "react";
import { formatMoney, formatPercent } from "../../lib/format";
import type { AllocationEntry, Portfolio } from "../../lib/types";
import { HealthTab } from "../../components/HealthTab";
import { OverlapTab } from "../../components/OverlapTab";
import { Segmented } from "../../components/ui";
import { PageParts } from "./PageParts";

const inr = (value: number) => formatMoney(value, "INR", "compact");

// "Is my portfolio built well?": the explained score, then the two things it
// rests on most, what the funds own together and how the money is split.
export function HealthPage({ data }: { data: Portfolio }) {
  return (
    <PageParts
      parts={[
        { id: "score", title: "Health score", description: "Six measurable factors, each with its evidence, and every change explained.", content: <HealthTab /> },
        { id: "overlap", title: "Overlap", description: "What all your funds own together, company by company and sector by sector.", content: <OverlapTab /> },
        { id: "allocation", title: "Allocation", description: "How your money is split, by category, asset class and fund house.", content: <AllocationCard data={data} /> }
      ]}
    />
  );
}

function AllocationCard({ data }: { data: Portfolio }) {
  const [by, setBy] = useState<"byCategory" | "byAssetClass" | "byFundHouse">("byCategory");
  const entries: AllocationEntry[] = data.allocation[by];
  const largest = entries[0]?.value || 1;

  return (
    <div className="card">
      <div className="row between" style={{ alignItems: "start", marginBottom: 14 }}>
        <div className="sub" style={{ marginBottom: 0 }}>Share of current value.</div>
        <Segmented
          label="Group by"
          value={by}
          onChange={setBy}
          options={[{ value: "byCategory", label: "Category" }, { value: "byAssetClass", label: "Asset" }, { value: "byFundHouse", label: "AMC" }]}
        />
      </div>
      <div className="breakdown">
        {entries.map(entry => (
          <div className="breakdown-row" key={entry.name}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            <span className="amount small">{formatPercent(entry.share, { sign: false, digits: 1 })} · {inr(entry.value)}</span>
            <div className="bar"><span style={{ width: `${(entry.value / largest) * 100}%`, transition: "width 400ms ease" }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
