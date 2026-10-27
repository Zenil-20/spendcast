import { useId, useState, type FormEvent } from "react";
import { AlertTriangle, Info, Search } from "lucide-react";
import { useCandidateCheck, useFundSearch, useOverlap } from "../lib/queries";
import { useDebounced } from "../lib/hooks";
import { formatDate, formatMoney, formatPercent } from "../lib/format";
import type { CandidateCheck, CompanyExposure, Overlap, SchemeSearchResult } from "../lib/types";
import { Button, Field, MoneyInput, Skeleton } from "./ui";

/*
 * Look-through overlap: what all the funds own together, company by company
 * and sector by sector, from each fund's disclosed holdings. Where holdings
 * aren't available it falls back to how alike the funds' returns are, and
 * says so.
 */

const inr = (value: number, style: "whole" | "compact" = "whole") => formatMoney(value, "INR", style);
const share = (value: number, digits = 1) => formatPercent(value, { sign: false, digits });

export function OverlapTab() {
  const overlap = useOverlap();

  if (overlap.isPending) return <Skeleton height={320} />;
  if (overlap.isError) return <div className="notice error" role="alert"><AlertTriangle size={16} /><div>{overlap.error.message}</div></div>;
  const data = overlap.data;

  return (
    <div className="stack" style={{ gap: 24 }}>
      {data.summary.length > 0 && (
        <section className="card" aria-label="Overlap summary">
          <h3>What your funds own together</h3>
          <div className="sub">Across all your funds, not one fund at a time{data.coverage.funds.length ? ` · holdings as of ${latestDisclosure(data)}` : ""}.</div>
          <ul className="evidence-list">{data.summary.map(line => <li key={line}>{line}</li>)}</ul>
        </section>
      )}

      <Coverage data={data} />

      {data.coverage.value > 0 && (
        <>
          <div className="stat-row" style={{ margin: 0 }}>
            <div>
              <div className="k">Companies you own</div>
              <div className="v">{data.companyCount}</div>
            </div>
            <div>
              <div className="k">Held through 2+ funds</div>
              <div className="v">{data.commonCount}</div>
              <div className="s ink-3">{share(data.commonShare, 0)} of your money</div>
            </div>
            <div>
              <div className="k">Spread like</div>
              <div className="v">{data.concentration.effectiveHoldings ? Math.round(data.concentration.effectiveHoldings) : "—"}</div>
              <div className="s ink-3">equal holdings</div>
            </div>
            <div>
              <div className="k">Top 10 companies</div>
              <div className="v">{data.concentration.top10Share !== null ? share(data.concentration.top10Share, 0) : "—"}</div>
              <div className="s ink-3">of what you own</div>
            </div>
          </div>

          <CompanyTable title="Held through more than one fund" sub="The hidden overlap: the same company bought through different funds." companies={data.common} empty="No company is held through more than one of your funds." />

          <div className="cards-2">
            <Sectors data={data} />
            <Pairs data={data} />
          </div>

          <CompanyTable title="Largest companies overall" sub={`Your ${Math.min(25, data.companyCount)} largest exposures, wherever they come from. ${data.cash.share > 0.005 ? `Plus ${share(data.cash.share)} in cash and other assets.` : ""}`} companies={data.companies} empty="No holdings." />
        </>
      )}

      <Correlations data={data} />
      <CandidateChecker />
    </div>
  );
}

function latestDisclosure(data: Overlap) {
  const dates = data.coverage.funds.map(fund => fund.asOf).sort();
  return formatDate(dates[dates.length - 1], { month: "short", year: "numeric" });
}

function Coverage({ data }: { data: Overlap }) {
  const stale = data.coverage.funds.filter(fund => fund.stale);
  if (!data.coverage.missing.length && !stale.length) return null;

  return (
    <div className="notice" role="note">
      <Info size={16} />
      <div>
        {data.coverage.missing.length > 0 && (
          <div>
            Holdings are known for {share(data.coverage.share, 0)} of your money. Not included: {data.coverage.missing.map(fund => fund.shortName).join(", ")}.
            {data.coverage.value === 0 && " Until holdings are loaded, the comparison below uses how your funds' returns move together."}
          </div>
        )}
        {stale.length > 0 && <div>Holdings older than four months: {stale.map(fund => `${fund.shortName} (${formatDate(fund.asOf, { month: "short", year: "numeric" })})`).join(", ")}.</div>}
      </div>
    </div>
  );
}

function CompanyTable({ title, sub, companies, empty }: { title: string; sub: string; companies: CompanyExposure[]; empty: string }) {
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      <div className="sub">{sub}</div>
      {companies.length === 0 ? <p className="small ink-3">{empty}</p> : (
        <div className="table-scroll">
          <table className="ledger compact">
            <thead>
              <tr><th>Company</th><th>Through</th><th className="num">Amount</th><th className="num">Of what you own</th></tr>
            </thead>
            <tbody>
              {companies.map(company => (
                <tr key={company.key}>
                  <td>
                    <div>{company.name}</div>
                    {company.sector && <div className="small ink-3">{company.sector}</div>}
                  </td>
                  <td className="small ink-2">{company.funds.map(fund => `${fund.shortName} ${share(fund.weight)}`).join(" · ")}</td>
                  <td className="num">{inr(company.amount)}</td>
                  <td className="num">{share(company.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Sectors({ data }: { data: Overlap }) {
  const sectors = data.sectors.slice(0, 10);
  const largest = sectors[0]?.share || 1;

  return (
    <section className="card" aria-label="Sectors">
      <h3>Sectors</h3>
      <div className="sub">Share of your equity. "Duplicated" means two or more funds each put 10%+ of their money there.</div>
      <div className="breakdown">
        {sectors.map(sector => (
          <div className="breakdown-row" key={sector.sector} title={sector.funds.map(fund => `${fund.shortName}: ${share(fund.weight)} of the fund`).join("\n")}>
            <span>{sector.sector} {sector.duplicated && <span className="badge warn">Duplicated · {sector.heavyFunds} funds</span>}</span>
            <span className="amount small">{share(sector.share)} · {inr(sector.amount, "compact")}</span>
            <div className="bar"><span style={{ width: `${(sector.share / largest) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pairs({ data }: { data: Overlap }) {
  return (
    <section className="card" aria-label="Overlap between funds">
      <h3>Overlap between funds</h3>
      <div className="sub">How much of two funds is the same companies, at the same weights. 100% would be identical.</div>
      {data.pairs.length === 0 && <p className="small ink-3">Needs holdings for at least two funds.</p>}
      <div className="breakdown">
        {data.pairs.slice(0, 8).map(pair => (
          <div className="breakdown-row" key={`${pair.a.schemeCode}-${pair.b.schemeCode}`}>
            <span style={{ minWidth: 0 }}>{pair.a.shortName} & {pair.b.shortName}</span>
            <span className="amount small">{share(pair.overlap, 0)} · {pair.commonCount} shared</span>
            <div className={`bar ${pair.overlap >= 0.5 ? "warn" : ""}`}><span style={{ width: `${pair.overlap * 100}%` }} /></div>
            {pair.topShared.length > 0 && <span className="small ink-3" style={{ gridColumn: "1 / -1" }}>Including {pair.topShared.slice(0, 3).join(", ")}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Correlations({ data }: { data: Overlap }) {
  if (!data.correlations.length) return null;

  return (
    <section className="card" aria-label="How alike your funds move">
      <h3>How alike your funds move</h3>
      <div className="sub">Correlation of monthly returns over up to 3 years: 1 means they rise and fall together. Funds that own similar companies move alike, so this works even without holdings.</div>
      <div className="table-scroll">
        <table className="ledger compact">
          <thead><tr><th>Funds</th><th className="num">Correlation</th><th>Reading</th><th className="num">Months</th></tr></thead>
          <tbody>
            {data.correlations.map(pair => (
              <tr key={`${pair.a.schemeCode}-${pair.b.schemeCode}`}>
                <td>{pair.a.shortName} & {pair.b.shortName}</td>
                <td className="num">{pair.correlation === null ? "—" : pair.correlation.toFixed(2)}</td>
                <td className="small ink-2">{pair.label}</td>
                <td className="num">{pair.months}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VERDICTS: Record<CandidateCheck["verdict"], { label: string; tone: string }> = {
  improves: { label: "Adds diversification", tone: "good" },
  marginal: { label: "Adds a little", tone: "mid" },
  duplicates: { label: "Mostly what you already own", tone: "low" },
  unknown: { label: "Can't tell yet", tone: "" }
};

function CandidateChecker() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SchemeSearchResult | null>(null);
  const [amount, setAmount] = useState("");
  const search = useFundSearch(useDebounced(picked ? "" : query, 300));
  const check = useCandidateCheck();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!picked) return;
    check.mutate({ schemeCode: picked.schemeCode, amount: Number(amount) >= 500 ? Number(amount) : undefined });
  }

  const result = check.data;
  const verdict = result ? VERDICTS[result.verdict] : null;

  return (
    <section className="card" aria-label="Would another fund help?">
      <h3>Would another fund add diversification?</h3>
      <div className="sub">Check a fund before you buy it: how much of it you already own through your current funds.</div>

      <form onSubmit={submit} className="candidate-form" noValidate>
        <Field label="Fund" htmlFor={`${id}-q`}>
          <div className="affix">
            <Search size={14} className="affix-start ink-3" />
            <input
              id={`${id}-q`}
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Search by name or scheme code"
              value={picked ? picked.schemeName : query}
              onChange={event => { setPicked(null); setQuery(event.target.value); check.reset(); }}
            />
          </div>
        </Field>
        <Field label="Amount (optional)" htmlFor={`${id}-a`} hint="Defaults to the size of your average fund">
          <MoneyInput id={`${id}-a`} currency="INR" value={amount} onChange={setAmount} />
        </Field>
        <div style={{ alignSelf: "end" }}>
          <Button variant="primary" type="submit" disabled={!picked} loading={check.isPending}>Check</Button>
        </div>
      </form>

      {!picked && search.data && search.data.results.length > 0 && query.trim().length >= 2 && (
        <ul className="search-results" role="listbox" aria-label="Matching funds">
          {search.data.results.slice(0, 6).map(fund => (
            <li key={fund.schemeCode}>
              <button type="button" onClick={() => setPicked(fund)}>
                {fund.schemeName} <span className="ink-3 mono small">{fund.schemeCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {check.isError && <div className="notice error" role="alert" style={{ marginTop: 12 }}>{check.error.message}</div>}
      {result && verdict && (
        <div className="candidate-result" aria-live="polite">
          <div className={`odds-figure ${verdict.tone}`}><span className="lbl">{verdict.label}</span></div>
          <div className="small ink-3">
            {result.shortName} · {inr(result.amount)} · {result.method === "holdings" ? "compared by holdings" : result.method === "returns" ? "compared by returns" : ""}
            {result.alreadyHeld && " · you already hold this fund"}
          </div>
          <ul className="evidence-list">{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
