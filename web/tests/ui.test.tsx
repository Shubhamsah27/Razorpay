import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import showcaseData from "../src/data/showcase.json";
import { ArmsChart, DeltaChart } from "../src/components/Charts";
import { RecoveryTimeline } from "../src/components/RecoveryTimeline";
import { CaseQueue, matchesFilter } from "../src/components/CaseQueue";
import { FieldPanel } from "../src/components/FieldPanel";
import { PipelineFlow, attemptNumbers, buildStages } from "../src/components/PipelineFlow";
import { buildTiles } from "../src/components/CaseField";
import { caseStatus, wasStoppedByGuard } from "../src/lib/caseStatus";
import type { CaseAudit, Showcase } from "../src/types";

const showcase = showcaseData as unknown as Showcase;

function byId(caseId: string): CaseAudit {
  const audit = showcase.cases.find((entry) => entry.caseId === caseId);
  if (audit === undefined) throw new Error(`missing fixture case ${caseId}`);
  return audit;
}

const multiAttempt = showcase.cases.filter((audit) => audit.decisions.length > 1);

describe("attempt-aware pipeline", () => {
  test("the fixture contains a multi-attempt case to reason about", () => {
    expect(multiAttempt.length).toBeGreaterThan(0);
  });

  test("stages are built from the decision and action of that attempt only", () => {
    for (const audit of multiAttempt.slice(0, 40)) {
      for (const attempt of attemptNumbers(audit)) {
        const decision = audit.decisions.find((d) => d.attemptNumber === attempt);
        const action = audit.actions.find((a) => a.attemptNumber === attempt);
        const stages = buildStages(audit, decision, action);

        const value = stages.find((s) => s.key === "value")!;
        const guard = stages.find((s) => s.key === "guard")!;
        const actionStage = stages.find((s) => s.key === "action")!;

        // Expected value must be this attempt's, never another's.
        if (decision !== undefined) {
          expect(value.value).toContain(
            Math.abs(Math.round(decision.expectedValuePaise / 100)).toLocaleString("en-IN"),
          );
          expect(guard.value.toLowerCase()).toBe(
            decision.guard.decision.replace(/_/g, " "),
          );
        }

        // A blocked attempt must never show an external effect.
        const stopped =
          decision !== undefined && decision.outcome !== "approved";
        if (stopped && action === undefined) {
          expect(actionStage.value).toBe("None");
          expect(actionStage.status).toBe("unreached");
        }
      }
    }
  });

  test("a blocked attempt never inherits another attempt's action", () => {
    for (const audit of multiAttempt) {
      for (const decision of audit.decisions) {
        if (decision.outcome === "approved") continue;
        const action = audit.actions.find((a) => a.attemptNumber === decision.attemptNumber);
        const stages = buildStages(audit, decision, action);
        const guard = stages.find((s) => s.key === "guard")!;
        expect(guard.status).toBe("stopped");

        if (action === undefined) {
          expect(stages.find((s) => s.key === "provider")!.status).toBe("unreached");
          expect(stages.find((s) => s.key === "outcome")!.status).toBe("unreached");
        }
      }
    }
  });

  test("the Card Expired example explains fatigue pricing across attempts", () => {
    const audit = byId("case_00001");
    const attempts = attemptNumbers(audit);
    expect(attempts.length).toBeGreaterThan(1);

    const first = audit.decisions.find((d) => d.attemptNumber === 1)!;
    const second = audit.decisions.find((d) => d.attemptNumber === 2)!;

    expect(first.outcome).toBe("approved");
    expect(first.expectedValuePaise).toBeGreaterThan(0);

    expect(second.outcome).toBe("blocked");
    expect(second.expectedValuePaise).toBeLessThan(0);
    expect(second.guard.rules.map((r) => r.rule)).toContain("negative_expected_value");

    // And the rendered stages must carry that difference, not merge it.
    const one = buildStages(audit, first, audit.actions.find((a) => a.attemptNumber === 1));
    const two = buildStages(audit, second, audit.actions.find((a) => a.attemptNumber === 2));
    expect(one.find((s) => s.key === "guard")!.status).toBe("passed");
    expect(two.find((s) => s.key === "guard")!.status).toBe("stopped");
    expect(two.find((s) => s.key === "action")!.value).toBe("None");
  });

  test("each attempt renders its own pipeline without crashing", () => {
    const audit = byId("case_00001");
    for (const attempt of attemptNumbers(audit)) {
      const html = renderToString(
        <PipelineFlow audit={audit} attempt={attempt} onAttemptChange={() => {}} />,
      );
      expect(html).toContain("Safety guard");
      expect(html).toContain(`data-attempt="${attempt}"`);
    }
  });
});

describe("stopped-filter semantics", () => {
  test("stopped means guard-stopped, not merely action-less", () => {
    const actionless = showcase.cases.filter((audit) => audit.actions.length === 0);
    const stopped = showcase.cases.filter((audit) => matchesFilter(audit, "blocked"));

    // Every stopped case is action-less, but not every action-less case is stopped.
    for (const audit of stopped) {
      expect(audit.actions.length).toBe(0);
      expect(wasStoppedByGuard(audit)).toBe(true);
    }
    expect(stopped.length).toBeLessThanOrEqual(actionless.length);
  });

  test("a case that settled organically with no guard block is not stopped", () => {
    const organic = showcase.cases.filter(
      (audit) => audit.actions.length === 0 && !wasStoppedByGuard(audit),
    );
    for (const audit of organic) {
      expect(matchesFilter(audit, "blocked")).toBe(false);
      expect(caseStatus(audit)).not.toBe("stopped");
    }
  });

  test("filters agree with the status shown on each row", () => {
    for (const audit of showcase.cases) {
      if (caseStatus(audit) === "reconciled") {
        expect(matchesFilter(audit, "reconciled")).toBe(true);
      }
      if (matchesFilter(audit, "recovered")) {
        expect(audit.incrementalPaise).toBeGreaterThan(0);
      }
    }
  });
});

describe("field tiles map to real cases", () => {
  const tiles = buildTiles(showcase.cases);

  test("one tile per case, in case order", () => {
    expect(tiles.length).toBe(showcase.cases.length);
    tiles.forEach((tile, index) => {
      expect(tile.caseId).toBe(showcase.cases[index]!.caseId);
    });
  });

  test("tile colour is the case's real status", () => {
    tiles.forEach((tile, index) => {
      expect(tile.status).toBe(caseStatus(showcase.cases[index]!));
    });
  });

  test("tile height tracks the real amount at risk", () => {
    const amounts = showcase.cases.map((audit) => audit.amountPaise);
    const maxIndex = amounts.indexOf(Math.max(...amounts));
    const minIndex = amounts.indexOf(Math.min(...amounts));
    expect(tiles[maxIndex]!.height).toBeGreaterThan(tiles[minIndex]!.height);
    for (const tile of tiles) {
      expect(tile.height).toBeGreaterThanOrEqual(0);
      expect(tile.height).toBeLessThanOrEqual(1);
    }
  });

  test("selecting a tile index resolves to the matching queue case", () => {
    const target = showcase.scenes.reconciled_failure!;
    const index = tiles.findIndex((tile) => tile.caseId === target);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(tiles[index]!.caseId).toBe(target);
    expect(byId(tiles[index]!.caseId).caseId).toBe(target);
  });

  test("the static fallback exposes every case as a labelled control", () => {
    const html = renderToString(
      <FieldPanel
        cases={showcase.cases.slice(0, 12)}
        selectedId={showcase.cases[0]!.caseId}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("aria-label");
    expect(html).toContain("one tile each");
  });
});

describe("charts are keyboard and screen-reader reachable", () => {
  test("arm bars are focusable and carry their full values", () => {
    const html = renderToString(<ArmsChart arms={showcase.arms} />);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("net value");
    for (const arm of showcase.arms) {
      expect(html).toContain(arm.actionsExecuted.toLocaleString("en-IN"));
    }
  });

  test("diverging rows are focusable and state which side is ahead", () => {
    const recoup = showcase.arms.find((a) => a.armName === "recoup")!;
    const fixed = showcase.arms.find((a) => a.armName === "fixed_retry_3x24h")!;
    const html = renderToString(<DeltaChart challenger={recoup} baseline={fixed} />);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("ahead by");
  });

  test("the timeline is focusable and describes itself", () => {
    const html = renderToString(<RecoveryTimeline timeline={showcase.timeline} arms={showcase.arms} />);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("arrow keys");
    expect(html).toContain("Recovery rate");
  });

  test("the queue advertises its keyboard shortcuts", () => {
    const html = renderToString(
      <CaseQueue
        cases={showcase.cases.slice(0, 8)}
        selectedId={showcase.cases[0]!.caseId}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("<kbd>j</kbd>");
    expect(html).toContain("<kbd>k</kbd>");
  });
});

describe("timeline data is consistent with the headline metrics", () => {
  test("each arm's final cumulative recovery matches its gross recovered", () => {
    for (const series of showcase.timeline.series) {
      const arm = showcase.arms.find((entry) => entry.armName === series.armName)!;
      const final = series.cumulativeRecoveredPaise[series.cumulativeRecoveredPaise.length - 1]!;
      expect(final).toBe(arm.grossRecoveredPaise);
    }
  });

  test("cumulative curves never decrease", () => {
    for (const series of showcase.timeline.series) {
      for (let i = 1; i < series.cumulativeRecoveredPaise.length; i += 1) {
        expect(series.cumulativeRecoveredPaise[i]!).toBeGreaterThanOrEqual(
          series.cumulativeRecoveredPaise[i - 1]!,
        );
      }
    }
  });
});
