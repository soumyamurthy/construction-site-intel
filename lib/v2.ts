import rules from "../config/v2-rules.json";
import { Signal } from "./types";
import { CostDriver, PMAction, BidAssumption, ContingencyRange } from "./types-v2";

type SeverityKey = "high" | "medium" | "low";

type RuleConfig = {
  signalId: string;
  costCategory: string;
  impactType: CostDriver["impactType"];
  deltas: Record<SeverityKey, { pct: number[]; days: number[] }>;
  rationale: string;
};

type ActionConfig = Omit<PMAction, "id" | "relatedSignalId" | "priority">;

type Config = {
  costRules: RuleConfig[];
  actionLibrary: Record<string, ActionConfig>;
  contingencyBands: Array<ContingencyRange & { minScore: number }>;
  baselineBidAssumptions: BidAssumption[];
  conditionalBidAssumptions: {
    highFlood: BidAssumption;
    highFire: BidAssumption;
  };
};

const config = rules as Config;

function pair(values: number[]): [number, number] {
  const first = Number(values?.[0] ?? 0);
  const second = Number(values?.[1] ?? first);
  return [first, second];
}

function rankSeverity(severity: Signal["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function asSeverity(severity: Signal["severity"]): SeverityKey | null {
  if (severity === "high" || severity === "medium" || severity === "low") {
    return severity;
  }
  return null;
}

export function buildCostDrivers(signals: Signal[]): CostDriver[] {
  const byId = new Map(signals.map((signal) => [signal.id, signal]));

  return config.costRules.map((rule): CostDriver | null => {
    const signal = byId.get(rule.signalId);
    if (!signal) return null;

    const severity = asSeverity(signal.severity);
    if (!severity) return null;

    const delta = rule.deltas[severity];
    const [costMin, costMax] = pair(delta.pct);
    const [daysMin, daysMax] = pair(delta.days);

    return {
      id: `driver-${rule.signalId}`,
      signalId: rule.signalId,
      label: signal.label,
      severity,
      costCategory: rule.costCategory,
      impactType: rule.impactType,
      estimatedCostDeltaPct: { min: costMin, max: costMax },
      estimatedScheduleDeltaDays: { min: daysMin, max: daysMax },
      rationale: rule.rationale
    };
  }).filter((driver): driver is CostDriver => driver !== null)
    .sort((a, b) => rankSeverity(b.severity) - rankSeverity(a.severity));
}

export function buildPMActions(signals: Signal[]): PMAction[] {
  const actions: PMAction[] = [];

  for (const signal of signals) {
    if (signal.severity === "unknown" || signal.severity === "low") continue;
    const template = config.actionLibrary[signal.id];
    if (!template) continue;

    actions.push({
      id: `action-${signal.id}`,
      relatedSignalId: signal.id,
      priority: signal.severity === "high" ? "high" : "medium",
      ...template
    });
  }

  if (!actions.length) {
    actions.push({
      id: "action-baseline",
      title: "Proceed with standard preconstruction validation",
      owner: "Project Manager",
      duePhase: "Bid",
      leadTimeDays: 3,
      priority: "low",
      relatedSignalId: "baseline"
    });
  }

  return actions.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

export function buildContingency(signals: Signal[]): ContingencyRange {
  let score = 0;
  for (const signal of signals) {
    score += rankSeverity(signal.severity);
  }

  const sortedBands = [...config.contingencyBands].sort((a, b) => b.minScore - a.minScore);
  const band = sortedBands.find((candidate) => score >= candidate.minScore) ?? sortedBands[sortedBands.length - 1];

  return {
    minPct: band.minPct,
    maxPct: band.maxPct,
    basis: band.basis
  };
}

export function buildBidAssumptions(signals: Signal[]): BidAssumption[] {
  const assumptions: BidAssumption[] = [...config.baselineBidAssumptions];

  const hasHighFlood = signals.some((signal) => signal.id === "flood-zone" && signal.severity === "high");
  const hasHighFire = signals.some((signal) => signal.id === "wildfire-risk" && signal.severity === "high");

  if (hasHighFlood) {
    assumptions.push(config.conditionalBidAssumptions.highFlood);
  }

  if (hasHighFire) {
    assumptions.push(config.conditionalBidAssumptions.highFire);
  }

  return assumptions;
}

export function scoreConfidence(signals: Signal[], warnings: string[]): { confidenceScore: number; dataCompletenessPct: number } {
  const totalSignals = signals.length || 1;
  const knownSignals = signals.filter((signal) => signal.value !== "Not available" && signal.value !== "Unknown").length;
  const completeness = Math.round((knownSignals / totalSignals) * 100);

  const warningPenalty = Math.min(warnings.length * 6, 30);
  const availabilityPenalty = Math.max(0, 100 - completeness) * 0.4;
  const confidenceScore = Math.max(35, Math.round(100 - warningPenalty - availabilityPenalty));

  return {
    confidenceScore,
    dataCompletenessPct: completeness
  };
}
