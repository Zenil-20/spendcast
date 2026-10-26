import { useId, useState } from "react";
import { useHarvest } from "../lib/queries";
import { useDebounced } from "../lib/hooks";
import { formatDate, formatMoney, formatUnits } from "../lib/format";
import type { HarvestPlan } from "../lib/types";
import { Field, MoneyInput } from "./ui";

const inr = (value: number, style: "full" | "whole" | "compact" = "whole") => formatMoney(value, "INR", style);

// The yearly tax-free long-term gains harvest: which units to sell and buy
// back so this year's ₹1.25 lakh exemption isn't wasted.
export function HarvestCard({ initial }: { initial: HarvestPlan }) {
  const id = useId();
  const [bookedText, setBookedText] = useState("");
  const booked = useDebounced(Number(bookedText) || 0, 400);
  const query = useHarvest(booked);
  const plan = booked > 0 ? query.data ?? initial : initial;
  const loading = booked > 0 && query.isFetching;
  const used = Math.min(plan.exemption, plan.alreadyBooked + plan.gainBooked);

  return (
    <section className="card harvest" aria-label="Tax-free gains harvest">
      <div className="harvest-head">
        <div>
          <h3>Tax-free gains · FY {plan.financialYear}</h3>
          <div className="sub" style={{ marginBottom: 0 }}>
            Up to {inr(plan.exemption)} of long-term equity gains are tax-free each financial year, and unused room doesn't carry
            forward. Selling units and buying them straight back books the gain inside that limit and raises your purchase price,
            so the same gain is never taxed later.
          </div>
        </div>
        <div className="harvest-deadline">
          <div className="k">Deadline</div>
          <div className="v">{formatDate(plan.deadline, { day: "numeric", month: "short", year: "numeric" })}</div>
          <div className="s">{plan.daysLeft} days left</div>
        </div>
      </div>

      {(initial.available > 0 || booked > 0) && <div className="harvest-grid">
        <Field label="Long-term gains already booked this year" htmlFor={`${id}-booked`} hint="From any equity fund sold since 1 April, here or elsewhere. Leave empty if none.">
          <MoneyInput id={`${id}-booked`} currency="INR" value={bookedText} onChange={setBookedText} />
        </Field>
        <div>
          <div className="row between small ink-2" style={{ marginBottom: 6 }}>
            <span>Exemption used with this plan</span>
            <span className="amount">
              {plan.alreadyBooked > 0 && `${inr(Math.min(plan.alreadyBooked, plan.exemption))} booked + ${inr(plan.gainBooked)} here = `}
              {inr(used)} of {inr(plan.exemption)}{loading && " …"}
            </span>
          </div>
          <div className="progress ok" aria-hidden="true">
            <span style={{ width: `${(used / plan.exemption) * 100}%` }} />
          </div>
        </div>
      </div>}

      {plan.plan.length > 0 ? (
        <>
          <div className="table-scroll">
            <table className="compare-table">
              <thead>
                <tr><th>Fund</th><th>Units to sell</th><th>About</th><th>Gain booked</th></tr>
              </thead>
              <tbody>
                {plan.plan.map(item => (
                  <tr key={item.schemeCode}>
                    <td>
                      {item.shortName}
                      <div className="small ink-3">Oldest units first, from {formatDate(item.oldestLot, { month: "short", year: "numeric" })}</div>
                    </td>
                    <td>{formatUnits(item.units)}</td>
                    <td>{inr(item.amount)}</td>
                    <td className="up">{inr(item.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stat-row" style={{ margin: 0 }}>
            <div><div className="k">Gains booked tax-free</div><div className="v">{inr(plan.gainBooked)}</div></div>
            <div><div className="k">Tax avoided later</div><div className="v up">{inr(plan.taxAvoided)}</div><div className="s ink-3">12.5% + cess</div></div>
            <div><div className="k">Cost to buy back</div><div className="v">{inr(plan.costs, "full")}</div><div className="s ink-3">stamp duty</div></div>
          </div>

          <ol className="harvest-steps small ink-2">
            <li>Redeem the units above. Your fund sells the oldest units first, which is what this plan assumes.</li>
            <li>Once the money reaches your bank, buy the same fund again with the same amount. You're out of the market for those 2–3 days.</li>
            <li>The new units start a fresh 12-month clock before they're long-term again.</li>
          </ol>
        </>
      ) : (
        <p className="small ink-2">
          {plan.remaining <= 0
            ? "You've already used this year's exemption — there's nothing more to book tax-free."
            : plan.available <= 0 && plan.earliestLongTerm
              ? `None of your equity units are long-term yet. The first, in ${plan.earliestLongTerm.shortName}, become long-term on ${formatDate(plan.earliestLongTerm.date)}.`
              : "None of your equity funds have long-term gains to book right now."}
        </p>
      )}

      <p className="disclaimer">
        Check the fund's exit load before selling — most equity funds charge none after a year, some do up to 18–24 months. ELSS units
        are only included after their 3-year lock-in. Estimate under current rules; not tax advice.
      </p>
    </section>
  );
}
