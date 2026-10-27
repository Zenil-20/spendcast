import type { Portfolio } from "../../lib/types";
import { GoalsTab } from "../../components/Goals";
import { ForecastTab } from "../../components/ForecastTab";
import { PageParts } from "./PageParts";

// "Will I get there?": each goal's chances, then the whole portfolio's
// range. Both replay the same market history, so their numbers agree.
export function PlanningPage({ data }: { data: Portfolio }) {
  return (
    <PageParts
      parts={[
        { id: "goals", title: "Goals", description: "Whether each goal is on track, and the smallest change that would fix it.", content: <GoalsTab holdings={data.holdings} /> },
        { id: "forecast", title: "Forecast", description: "Where all your money could be in 3 months to 3 years, and how your SIP changes that.", content: <ForecastTab /> }
      ]}
    />
  );
}
