import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import showcaseData from "./data/showcase.json";
import { CaseDetail } from "./components/CaseDetail";
import { CaseQueue } from "./components/CaseQueue";
import { FIELD_TILE_COUNT, Hero3D } from "./components/Hero3D";
import { PipelineFlow } from "./components/PipelineFlow";
import { ArmsChart, DeltaChart } from "./components/Charts";
import { percent, rupees, rupeesShort } from "./lib/format";
import type { ArmMetrics, SceneName, Showcase } from "./types";

const showcase = showcaseData as unknown as Showcase;

const SCENE_LABELS: Record<SceneName, string> = {
  auto_payment_link: "Auto Payment Link",
  human_review: "Human review",
  fraud_block: "Fraud block",
  subscription_observation: "Subscription observed",
  reconciled_failure: "Reconciled failure",
};

const METRIC_ROWS: { label: string; render(arm: ArmMetrics): string; higherIsBetter: boolean }[] = [
  { label: "Recovery rate", render: (arm) => percent(arm.recoveryRate), higherIsBetter: true },
  {
    label: "Gross recovered",
    render: (arm) => rupeesShort(arm.grossRecoveredPaise),
    higherIsBetter: true,
  },
  {
    label: "Net value",
    render: (arm) => rupeesShort(arm.netValuePaise),
    higherIsBetter: true,
  },
  {
    label: "Actions executed",
    render: (arm) => arm.actionsExecuted.toLocaleString("en-IN"),
    higherIsBetter: false,
  },
  {
    label: "Churn penalty",
    render: (arm) => rupeesShort(arm.churnPenaltyPaise),
    higherIsBetter: false,
  },
  {
    label: "False-positive contacts",
    render: (arm) => arm.falsePositiveContacts.toLocaleString("en-IN"),
    higherIsBetter: false,
  },
  {
    label: "Fraud cases left untouched",
    render: (arm) => String(arm.fraudCasesAvoided),
    higherIsBetter: true,
  },
];

function ArmTable({ arms }: { arms: ArmMetrics[] }) {
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            {arms.map((arm) => (
              <th key={arm.armName} className={arm.armName === "recoup" ? "col-recoup" : ""}>
                {arm.armName === "recoup" ? "Recoup" : arm.armName.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => {
            const values = arms.map((arm) => row.render(arm));
            const numeric = arms.map((arm) =>
              row.higherIsBetter ? arm.netValuePaise : -arm.actionsExecuted,
            );
            const best = numeric.indexOf(Math.max(...numeric));
            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                {values.map((value, index) => (
                  <td
                    key={index}
                    className={`${arms[index]!.armName === "recoup" ? "col-recoup" : ""} ${
                      index === best && row.label === "Net value" ? "winner" : ""
                    }`}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const recoup = showcase.arms.find((arm) => arm.armName === "recoup")!;
  const noAction = showcase.arms.find((arm) => arm.armName === "no_action")!;
  const fixed = showcase.arms.find((arm) => arm.armName === "fixed_retry_3x24h")!;
  const [showTable, setShowTable] = useState(false);

  const sceneEntries = useMemo(
    () =>
      (Object.entries(showcase.scenes) as [SceneName, string | null][]).filter(
        (entry): entry is [SceneName, string] => entry[1] !== null,
      ),
    [],
  );

  const [selectedId, setSelectedId] = useState<string>(
    sceneEntries[0]?.[1] ?? showcase.cases[0]!.caseId,
  );

  const selected =
    showcase.cases.find((audit) => audit.caseId === selectedId) ?? showcase.cases[0]!;

  const activeScene = sceneEntries.find(([, caseId]) => caseId === selectedId)?.[0] ?? null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          Recoup
        </div>
        <span className="topbar-sep" />
        <span className="topbar-note">Recovery Desk</span>
        <div className="topbar-right">
          <span className="badge neutral">seed {showcase.seed}</span>
          <span className="badge green">
            <span className="badge-dot" />
            deterministic
          </span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <motion.div
            className="eyebrow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            AI Revenue Recovery · Razorpay Buildathon
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            Recover the revenue that is <em>genuinely</em> recoverable
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            Recoup diagnoses each failed payment, prices the one recovery action worth
            taking, and puts it through a deterministic safety guard before anything
            reaches a customer. Every external effect has one durable identity and a full
            audit trail.
          </motion.p>

          <motion.div
            className="hero-stats"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="hero-stat">
              <div className="hero-stat-value" style={{ color: "var(--rzp-lime)" }}>
                {rupeesShort(showcase.incrementalNetValuePaise)}
              </div>
              <div className="hero-stat-label">Incremental net value</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value">{percent(recoup.recoveryRate)}</div>
              <div className="hero-stat-label">Recovery rate</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value">
                {percent(showcase.decisions.diagnosisAccuracy)}
              </div>
              <div className="hero-stat-label">Diagnosis accuracy</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value">
                {showcase.decisions.blocked.toLocaleString("en-IN")}
              </div>
              <div className="hero-stat-label">Blocked by guard</div>
            </div>
          </motion.div>
        </div>

        <motion.div
          className="field"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.1, delay: 0.3 }}
        >
          <div className="field-frame">
            <span className="crosshair tl" />
            <span className="crosshair tr" />
            <span className="crosshair bl" />
            <span className="crosshair br" />
            <Hero3D recoveryRate={recoup.recoveryRate} organicRate={noAction.recoveryRate} />
            <div className="field-caption">
              {FIELD_TILE_COUNT} tiles sampled from {recoup.caseCount.toLocaleString("en-IN")}{" "}
              cases · colour by outcome, in population proportion
            </div>
            <div className="field-legend">
              <span className="field-key">
                <span className="field-swatch" style={{ background: "#7ea0ff" }} />
                Recovered by Recoup
              </span>
              <span className="field-key">
                <span className="field-swatch" style={{ background: "#40566d" }} />
                Would have paid anyway
              </span>
              <span className="field-key">
                <span className="field-swatch" style={{ background: "#a08a4c" }} />
                Still at risk
              </span>
              <span className="field-key">
                <span className="field-swatch" style={{ background: "#192839" }} />
                Unrecoverable
              </span>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Against the <em>baselines</em></h2>
          <span>
            {recoup.caseCount.toLocaleString("en-IN")} cases · every arm reads the same
            potential-outcome table
          </span>
        </div>
        <div className="chart-grid">
          <div className="card">
            <ArmsChart arms={showcase.arms} />
          </div>
          <div className="card">
            <DeltaChart challenger={recoup} baseline={fixed} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="table-toggle"
            onClick={() => setShowTable((open) => !open)}
            aria-expanded={showTable}
          >
            {showTable ? "Hide" : "Show"} the numbers as a table
          </button>
        </div>
        {showTable && <ArmTable arms={showcase.arms} />}

        <div className="metric-grid" style={{ marginTop: 12 }}>
          <div className="card metric">
            <span className="metric-accent" style={{ background: "var(--rzp-lime)" }} />
            <div className="metric-label">Primary metric</div>
            <div className="metric-value" style={{ color: "var(--rzp-lime)" }}>
              {rupees(showcase.incrementalNetValuePaise)}
            </div>
            <div className="metric-sub">Net value over the fixed retry policy</div>
          </div>
          <div className="card metric">
            <span className="metric-accent" style={{ background: "var(--rzp-blue-light)" }} />
            <div className="metric-label">Fraud discipline</div>
            <div className="metric-value">{showcase.decisions.fraudCasesFrozen}</div>
            <div className="metric-sub">
              fraud cases frozen · {showcase.decisions.fraudBlocksOnLegitimateCases} clean cases
              wrongly blocked
            </div>
          </div>
          <div className="card metric">
            <span className="metric-accent" style={{ background: "var(--rzp-blue)" }} />
            <div className="metric-label">AI interpretation</div>
            <div className="metric-value">
              {percent(showcase.decisions.aiDiagnosisAccuracy)}
            </div>
            <div className="metric-sub">
              on {showcase.decisions.diagnosedByAi} ambiguous events the rules could not resolve
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="section-head">
          <h2>Recovery <em>Desk</em></h2>
          <span>every decision, guard rule, and provider transition on the record</span>
        </div>

        <div className="scene-nav" style={{ marginBottom: 16 }}>
          {sceneEntries.map(([scene, caseId]) => (
            <button
              type="button"
              key={scene}
              className={`scene-chip ${activeScene === scene ? "active" : ""}`}
              onClick={() => setSelectedId(caseId)}
            >
              {activeScene === scene && (
                <motion.span
                  layoutId="scene-pill"
                  className="scene-chip-bg"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              {SCENE_LABELS[scene]}
            </button>
          ))}
        </div>

        <div className="card pipeline-wrap">
          <div className="pipeline-head">
            <span className="eyebrow">Runtime path · {selected.caseId.replace("case_", "case #")}</span>
            <span className="pipeline-hint">
              every stage below is this case's own record, not an illustration
            </span>
          </div>
          <PipelineFlow audit={selected} />
        </div>

        <div className="desk">
          <CaseQueue
            cases={showcase.cases}
            selectedId={selected.caseId}
            onSelect={setSelectedId}
          />
          <CaseDetail audit={selected} />
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div className="legend">
            <span className="legend-item">
              <span className="badge razorpay">
                <span className="badge-dot" />
                Razorpay Test Mode
              </span>
              a real Payment Link or subscription observation
            </span>
            <span className="legend-item">
              <span className="badge simulated">
                <span className="badge-dot" />
                Simulated
              </span>
              never leaves the process
            </span>
          </div>
          <p>
            <strong>What these numbers are.</strong> Effectiveness figures are simulated
            causal results from a known synthetic world, generated from seed{" "}
            <code>{showcase.seed}</code>. They show that the policy makes better decisions
            than the baselines given that world; they are not production recovery rates.
          </p>
          <p style={{ marginTop: 10 }}>
            <strong>What Razorpay proves.</strong> Test Mode proves integration behaviour —
            Payment Link creation, payment confirmation, webhook verification, and
            subscription-state observation. Recoup never retries an arbitrary failed card
            payment, because a merchant cannot. Recurring retries belong to Razorpay; Recoup
            observes them.
          </p>
        </div>
      </footer>
    </div>
  );
}
