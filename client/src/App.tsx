import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/ui";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Dashboard } from "./pages/Dashboard";
import { Expenses } from "./pages/Expenses";
import { Recurring } from "./pages/Recurring";
import { Settings } from "./pages/Settings";
import { HoldingDetail } from "./pages/HoldingDetail";
import { InvestmentsLayout, SectionPage } from "./pages/investments/InvestmentsLayout";
import { ALL_SECTIONS, MOVED } from "./pages/investments/sections";

function Splash() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <span className="spinner ink-3" style={{ width: 20, height: 20 }} aria-label="Loading" />
    </div>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <Splash />;
  if (status === "signed-out") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { status } = useAuth();

  if (status === "loading") return <Splash />;
  return status === "signed-in" ? <Navigate to="/" replace /> : children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
      <Route element={<RequireAuth />}>
        <Route index element={<Dashboard />} />
        <Route path="ledger" element={<Expenses />} />
        <Route path="expenses" element={<Navigate to="/ledger" replace />} />
        <Route path="recurring" element={<Recurring />} />
        <Route path="investments" element={<InvestmentsLayout />}>
          {ALL_SECTIONS.map(section => section.path
            ? <Route key={section.path} path={section.path} element={<SectionPage section={section} />} />
            : <Route key="overview" index element={<SectionPage section={section} />} />)}
          {/* Sections that were merged into another page. */}
          {Object.entries(MOVED).map(([path, to]) => <Route key={path} path={path} element={<Navigate to={to} replace />} />)}
          {/* A fund's own page; named sections above take precedence over :id. */}
          <Route path=":id" element={<HoldingDetail />} />
        </Route>
        <Route path="settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="This page isn't in the ledger."
              text="The link may be old, or the page has moved."
              actions={<Link to="/" className="btn btn-secondary" style={{ textDecoration: "none" }}>Back to the overview</Link>}
            />
          }
        />
      </Route>
    </Routes>
  );
}
