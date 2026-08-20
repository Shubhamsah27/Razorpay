import { useCallback, useMemo, useState } from "react";
import { rupees, rupeesShort, titleise } from "../lib/format";
import type { ArmMetrics } from "../types";

/**
 * Categorical hues, fixed order, validated against the dark chart surface
 * (#0c111a) with the dataviz validator — all five checks pass, worst adjacent
 * CVD separation ΔE 10.4 (protan).
 */
export const ARM_COLOR: Record<string, string> = {
  no_action: "#2f9c86",
  fixed_retry_3x24h: "#c2842f",
  recoup: "#4d7fff",
};

/** Diverging poles: Recoup ahead vs baseline ahead. ΔE 24.9 (protan). */
const AHEAD = "#4d7fff";
const BEHIND = "#d1495b";

const ARM_LABEL: Record<string, string> = {
  no_action: "No action",
  fixed_retry_3x24h: "Fixed retry 3×24h",
  recoup: "Recoup",
};

function armLabel(name: string): string {
  return ARM_LABEL[name] ?? name;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  body: string;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (tip === null) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="chart-tip-title">{tip.title}</div>
      <div className="chart-tip-body">{tip.body}</div>
    </div>
  );
}

/** Hover, focus and tap all raise the same tooltip. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((next: Tip) => setTip(next), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function ArmsChart({ arms }: { arms: ArmMetrics[] }) {
  const { tip, show, hide } = useTip();
  const max = Math.max(...arms.map((arm) => arm.netValuePaise));

  return (
    <div className="chart" onMouseLeave={hide}>
      <div className="chart-head">
        <span className="chart-title">Net value by arm</span>
        <div className="chart-legend">
          {arms.map((arm) => (
            <span className="chart-key" key={arm.armName}>
              <span className="chart-swatch" style={{ background: ARM_COLOR[arm.armName] }} />
              {armLabel(arm.armName)}
            </span>
          ))}
        </div>
      </div>

      <ul className="bars" role="list">
        {arms.map((arm) => {
          const summary = `${armLabel(arm.armName)}: ${rupees(
            arm.netValuePaise,
          )} net value, ${arm.actionsExecuted.toLocaleString("en-IN")} actions executed, ${(
            arm.recoveryRate * 100
          ).toFixed(1)}% recovery rate`;
          const raise = () =>
            show({
              x: 16,
              y: 6,
              title: armLabel(arm.armName),
              body: `${rupees(arm.netValuePaise)} net · ${arm.actionsExecuted.toLocaleString(
                "en-IN",
              )} actions · ${(arm.recoveryRate * 100).toFixed(1)}% recovered`,
            });

          return (
            <li className="bar-row" key={arm.armName}>
              <span className="bar-label">{armLabel(arm.armName)}</span>
              <div
                className="bar-track"
                tabIndex={0}
                role="img"
                aria-label={summary}
                onMouseEnter={raise}
                onFocus={raise}
                onBlur={hide}
                onTouchStart={raise}
              >
                <span
                  className="bar-fill"
                  style={{
                    background: ARM_COLOR[arm.armName],
                    width: `${(arm.netValuePaise / max) * 100}%`,
                  }}
                />
              </div>
              <span className="bar-value">{rupeesShort(arm.netValuePaise)}</span>
            </li>
          );
        })}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}

interface DeltaChartProps {
  challenger: ArmMetrics;
  baseline: ArmMetrics;
}

/**
 * Per-class difference between Recoup and the fixed policy. Diverging on
 * purpose: the classes where the naive baseline still wins are the honest part
 * of the story, and a stacked or grouped chart would hide them.
 */
export function DeltaChart({ challenger, baseline }: DeltaChartProps) {
  const { tip, show, hide } = useTip();

  const rows = useMemo(
    () =>
      Object.keys(challenger.byFailureClass)
        .map((failureClass) => {
          const mine = challenger.byFailureClass[failureClass]?.netValuePaise ?? 0;
          const theirs = baseline.byFailureClass[failureClass]?.netValuePaise ?? 0;
          return {
            failureClass,
            delta: mine - theirs,
            cases: challenger.byFailureClass[failureClass]?.cases ?? 0,
          };
        })
        .sort((left, right) => right.delta - left.delta),
    [challenger, baseline],
  );

  const extent = Math.max(...rows.map((row) => Math.abs(row.delta))) || 1;

  return (
    <div className="chart" onMouseLeave={hide}>
      <div className="chart-head">
        <span className="chart-title">
          Where the value comes from
          <span className="chart-sub">Recoup minus fixed retry, by failure class</span>
        </span>
        <div className="chart-legend">
          <span className="chart-key">
            <span className="chart-swatch" style={{ background: AHEAD }} />
            Recoup ahead
          </span>
          <span className="chart-key">
            <span className="chart-swatch" style={{ background: BEHIND }} />
            Naive retry ahead
          </span>
        </div>
      </div>

      <ul className="diverging" role="list">
        {rows.map((row) => {
          const ahead = row.delta >= 0;
          const magnitude = (Math.abs(row.delta) / extent) * 50;
          const summary = `${titleise(row.failureClass)}: ${
            ahead ? "Recoup ahead by" : "naive retry ahead by"
          } ${rupees(Math.abs(row.delta))} across ${row.cases} cases`;
          const raise = () =>
            show({
              x: 16,
              y: 4,
              title: titleise(row.failureClass),
              body: `${ahead ? "+" : "−"}${rupees(Math.abs(row.delta))} vs the fixed policy · ${
                row.cases
              } cases`,
            });

          return (
            <li className="diverging-row" key={row.failureClass}>
              <span className="diverging-label">{titleise(row.failureClass)}</span>
              <div
                className="diverging-track"
                tabIndex={0}
                role="img"
                aria-label={summary}
                onMouseEnter={raise}
                onFocus={raise}
                onBlur={hide}
                onTouchStart={raise}
              >
                <span className="diverging-axis" />
                <span
                  className={`diverging-fill ${ahead ? "ahead" : "behind"}`}
                  style={{ background: ahead ? AHEAD : BEHIND, width: `${magnitude}%` }}
                />
              </div>
              <span className={`diverging-value ${ahead ? "ahead" : "behind"}`}>
                {ahead ? "+" : "−"}
                {rupeesShort(Math.abs(row.delta))}
              </span>
            </li>
          );
        })}
      </ul>
      <Tooltip tip={tip} />
    </div>
  );
}
