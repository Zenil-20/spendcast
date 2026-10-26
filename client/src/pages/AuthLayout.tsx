import type { ReactNode } from "react";
import { Wordmark } from "../components/ui";

// A printed-slip style preview of what the product does.
function Slip() {
  const bars = [62, 70, 58, 66, 74, 60, 68];

  return (
    <div className="slip" aria-hidden="true">
      <div className="row between">
        <span className="slip-title">November, forecast</span>
        <span>No. 0412</span>
      </div>
      <div className="bars">
        {bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
        <i className="f" style={{ height: "72%" }} />
        <i className="f" style={{ height: "86%" }} />
      </div>
      <div className="line"><span>Rent, due 1st</span><span>20,000</span></div>
      <div className="line"><span>Internet, due 7th</span><span>999</span></div>
      <div className="line"><span>Netflix, due 15th</span><span>649</span></div>
      <div className="line"><span>Everyday, estimated</span><span>23,311</span></div>
      <div className="total"><span>Expected</span><span>44,959</span></div>
      <div style={{ marginTop: 8, fontSize: 11 }}>Likely 36,900 – 53,000 · within budget</div>
    </div>
  );
}

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-story">
        <div className="wordmark"><Wordmark /></div>
        <div>
          <h1 className="display">Spend with the end of the month in mind.</h1>
          <p className="lede">
            Spendcast reads your own spending — the bills, the groceries, the December trip you take every year — and tells
            you, quietly and early, how this month and the next few will close.
          </p>
        </div>
        <Slip />
        <p className="auth-foot">Your data stays in your account. No bank connection required.</p>
      </section>

      <main className="auth-form">
        <div className="inner">
          <div className="wordmark mobile-wordmark" style={{ marginBottom: 32 }}><Wordmark /></div>
          <h2 className="title">{title}</h2>
          <p className="ink-2" style={{ marginTop: 8 }}>{subtitle}</p>
          {children}
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--rule)" }} className="ink-2 small">{footer}</div>
        </div>
      </main>
    </div>
  );
}
