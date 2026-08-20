import { useId, useState } from "react";
import { rupees, rupeesShort } from "../lib/format";
import { ARM_COLOR } from "./Charts";
import type { ArmMetrics, Timeline } from "../types";

const TL = { w: 640, h: 250, left: 66, right: 18, top: 16, bottom: 52 };

/** Grey dashed comparison line, matching the reference's previous-period line. */
const COMPARISON = "#5d6d86";

const LABEL: Record<string, string> = {
  recoup: "Recoup",
  no_action: "No-action baseline",
  fixed_retry_3x24h: "Fixed retry 3x24h",
};

interface Props {
  timeline: Timeline;
  arms: ArmMetrics[];
}

/**
 * Cumulative recovery across the horizon.
 *
 * Follows the visibility-score pattern from the AEO/GEO mockup: a headline
 * figure with its delta, ONE primary line by default, and checkboxes under the
 * plot that progressively reveal the dashed comparison and the competing
 * policy. Drawing all three arms at once buried the comparison the reader
 * actually came for.
 */
export function RecoveryTimeline({ timeline, arms }: Props) {
  const [showBaseline, setShowBaseline] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const titleId = useId();

  const seriesFor = (armName: string): number[] =>
    timeline.series.find((entry) => entry.armName === armName)?.cumulativeRecoveredPaise ?? [];

  const recoup = seriesFor("recoup");
  const recoupArm = arms.find((arm) => arm.armName === "recoup");
  const fixedArm = arms.find((arm) => arm.armName === "fixed_retry_3x24h");
  const deltaPoints =
    recoupArm !== undefined && fixedArm !== undefined
      ? (recoupArm.recoveryRate - fixedArm.recoveryRate) * 100
      : 0;

  const visible = [
    { key: "recoup", points: recoup, color: ARM_COLOR.recoup!, width: 2.5, dashed: false },
    ...(showBaseline
      ? [
          {
            key: "no_action",
            points: seriesFor("no_action"),
            color: COMPARISON,
            width: 1.5,
            dashed: true,
          },
        ]
      : []),
    ...(showPolicy
      ? [
          {
            key: "fixed_retry_3x24h",
            points: seriesFor("fixed_retry_3x24h"),
            color: ARM_COLOR.fixed_retry_3x24h!,
            width: 1.5,
            dashed: false,
          },
        ]
      : []),
  ];

  const max = Math.max(1, ...visible.flatMap((series) => series.points));
  const lastIndex = timeline.hours.length - 1;
  const xAt = (i: number): number => TL.left + (i / lastIndex) * (TL.w - TL.left - TL.right);
  const yAt = (v: number): number =>
    TL.h - TL.bottom - (v / max) * (TL.h - TL.bottom - TL.top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);

  const summary = `Recoup recovers ${rupees(
    recoup[lastIndex] ?? 0,
  )} across the horizon, a ${deltaPoints.toFixed(
    1,
  )} point higher recovery rate than the fixed retry policy.`;

  return (
    <div className="chart" onMouseLeave={() => setCursor(null)}>
      <div className="score-head">
        <span className="score-label" id={titleId}>
          Recovery rate
        </span>
        <div className="score-row">
          <span className="score-value">
            {recoupArm === undefined ? "-" : `${(recoupArm.recoveryRate * 100).toFixed(1)}%`}
          </span>
          <span className="score-pill">+{deltaPoints.toFixed(1)} pts</span>
        </div>
        <span className="chart-sub">
          Cumulative recovery over 14 days · {rupeesShort(recoup[lastIndex] ?? 0)} recovered
        </span>
      </div>

      <svg
        className="timeline-svg"
        viewBox={`0 0 ${TL.w} ${TL.h}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-desc`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            setCursor((current) => {
              const base = current ?? 0;
              const next = event.key === "ArrowRight" ? base + 1 : base - 1;
              return Math.max(0, Math.min(lastIndex, next));
            });
          }
          if (event.key === "Escape") setCursor(null);
        }}
        onBlur={() => setCursor(null)}
      >
        <desc id={`${titleId}-desc`}>{summary} Use arrow keys to read each day.</desc>

        {ticks.map((value, index) => (
          <g key={index}>
            <line
              x1={TL.left}
              y1={yAt(value)}
              x2={TL.w - TL.right}
              y2={yAt(value)}
              stroke="rgba(118,142,167,0.13)"
              strokeDasharray="2,3"
            />
            <text x={TL.left - 9} y={yAt(value) + 3} textAnchor="end" className="timeline-tick">
              {rupeesShort(value)}
            </text>
          </g>
        ))}

        <line
          x1={TL.left}
          y1={TL.top}
          x2={TL.left}
          y2={TL.h - TL.bottom}
          stroke="rgba(118,142,167,0.28)"
        />
        <line
          x1={TL.left}
          y1={TL.h - TL.bottom}
          x2={TL.w - TL.right}
          y2={TL.h - TL.bottom}
          stroke="rgba(118,142,167,0.28)"
        />

        <text
          className="timeline-axis"
          transform={`rotate(-90 15 ${(TL.top + TL.h - TL.bottom) / 2})`}
          x={15}
          y={(TL.top + TL.h - TL.bottom) / 2}
          textAnchor="middle"
        >
          Recovered
        </text>

        {visible.map((series) => (
          <polyline
            key={series.key}
            points={series.points.map((value, i) => `${xAt(i)},${yAt(value)}`).join(" ")}
            fill="none"
            stroke={series.color}
            strokeWidth={series.width}
            strokeDasharray={series.dashed ? "5,4" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {timeline.hours.map((hour, index) =>
          index % 4 === 0 || index === lastIndex ? (
            <text
              key={hour}
              x={xAt(index)}
              y={TL.h - TL.bottom + 18}
              textAnchor="middle"
              className="timeline-tick"
            >
              Day {Math.round(hour / 24)}
            </text>
          ) : null,
        )}

        <text
          x={(TL.left + TL.w - TL.right) / 2}
          y={TL.h - 8}
          textAnchor="middle"
          className="timeline-axis"
        >
          Days since failure
        </text>

        {cursor !== null && (
          <g>
            <line
              x1={xAt(cursor)}
              y1={TL.top}
              x2={xAt(cursor)}
              y2={TL.h - TL.bottom}
              stroke="rgba(118,142,167,0.45)"
            />
            {visible.map((series) => (
              <circle
                key={series.key}
                cx={xAt(cursor)}
                cy={yAt(series.points[cursor] ?? 0)}
                r={4}
                fill={series.color}
                stroke="#070a11"
                strokeWidth={1.5}
              />
            ))}
          </g>
        )}

        {timeline.hours.map((hour, index) => (
          <rect
            key={hour}
            x={xAt(index) - (TL.w - TL.left - TL.right) / lastIndex / 2}
            y={TL.top}
            width={(TL.w - TL.left - TL.right) / lastIndex}
            height={TL.h - TL.bottom - TL.top}
            fill="transparent"
            onMouseEnter={() => setCursor(index)}
            onTouchStart={() => setCursor(index)}
          />
        ))}
      </svg>

      {/* Checkbox legend under the plot, as in the reference design. */}
      <div className="score-legend">
        <span className="score-check is-fixed">
          <span className="score-swatch" style={{ background: ARM_COLOR.recoup }} />
          Recoup
        </span>
        <label className="score-check">
          <input
            type="checkbox"
            checked={showBaseline}
            onChange={(event) => setShowBaseline(event.target.checked)}
          />
          <span className="score-swatch dashed" />
          No-action baseline
        </label>
        <label className="score-check">
          <input
            type="checkbox"
            checked={showPolicy}
            onChange={(event) => setShowPolicy(event.target.checked)}
          />
          <span className="score-swatch" style={{ background: ARM_COLOR.fixed_retry_3x24h }} />
          Compare fixed retry
        </label>
      </div>

      {cursor !== null && (
        <div className="timeline-readout" role="status">
          <span className="timeline-readout-day">
            Day {Math.round((timeline.hours[cursor] ?? 0) / 24)}
          </span>
          {visible.map((series) => (
            <span className="timeline-readout-item" key={series.key}>
              <span className="chart-swatch" style={{ background: series.color }} />
              {LABEL[series.key] ?? series.key} {rupeesShort(series.points[cursor] ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
