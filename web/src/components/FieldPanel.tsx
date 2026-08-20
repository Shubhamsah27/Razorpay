import { Suspense, lazy, useEffect, useState } from "react";
import {
  caseStatus,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_SHORT,
  type CaseStatus,
} from "../lib/caseStatus";
import type { CaseAudit } from "../types";

// Three.js is ~1.2 MB of the bundle; it loads only once the field is wanted.
const CaseField = lazy(() => import("./CaseField"));

const LEGEND: CaseStatus[] = [
  "recovered",
  "reconciled",
  "organic",
  "stopped",
  "unrecovered",
];

/**
 * Static stand-in shown while Three.js loads and whenever reduced motion is
 * requested. It is drawn from the same case records, so it states the same
 * facts as the 3D field rather than being a spinner.
 */
function FlatField({
  cases,
  selectedId,
  onSelect,
}: {
  cases: CaseAudit[];
  selectedId: string;
  onSelect(caseId: string): void;
}) {
  return (
    <div className="flat-field">
      {cases.map((audit) => {
        const status = caseStatus(audit);
        return (
          <button
            type="button"
            key={audit.caseId}
            className={`flat-tile ${audit.caseId === selectedId ? "selected" : ""}`}
            style={{ background: STATUS_COLOR[status] }}
            title={`${audit.caseId.replace("case_", "#")} — ${STATUS_LABEL[status]}`}
            aria-label={`${audit.caseId.replace("case_", "#")}, ${STATUS_LABEL[status]}`}
            onClick={() => onSelect(audit.caseId)}
          />
        );
      })}
    </div>
  );
}

export function FieldPanel({
  cases,
  selectedId,
  onSelect,
}: {
  cases: CaseAudit[];
  selectedId: string;
  onSelect(caseId: string): void;
}) {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const counts = LEGEND.map((status) => ({
    status,
    count: cases.filter((audit) => caseStatus(audit) === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="field-frame">
      <span className="crosshair tl" />
      <span className="crosshair tr" />
      <span className="crosshair bl" />
      <span className="crosshair br" />

      {reduced ? (
        <FlatField cases={cases} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <Suspense
          fallback={<FlatField cases={cases} selectedId={selectedId} onSelect={onSelect} />}
        >
          <CaseField cases={cases} selectedId={selectedId} onSelect={onSelect} />
        </Suspense>
      )}

      <div className="field-footer">
        <span className="field-caption">
          {cases.length} cases · one tile each · height = amount at risk
        </span>
        <span className="field-legend">
          {counts.map((entry) => (
            <span className="field-key" key={entry.status}>
              <span
                className="field-swatch"
                style={{ background: STATUS_COLOR[entry.status] }}
              />
              {STATUS_SHORT[entry.status]} {entry.count}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
