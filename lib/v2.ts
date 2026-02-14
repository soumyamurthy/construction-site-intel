import rules from "../config/v2-rules.json";
import { ElevationSummary, FEMAData, SoilData, ClimateData } from "./sources";
import { Signal } from "./types";
import {
  CostDriver,
  PMAction,
  BidAssumption,
  ContingencyRange,
  PercentileTriple,
  ProbabilisticEstimate
} from "./types-v2";

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

function fmt(value?: number | null, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "Not available";
  return value.toFixed(digits);
}

function metroClass(point: { lat: number; lon: number }): "major-metro" | "metro" | "non-metro" {
  const inRange = (min: number, max: number, v: number) => v >= min && v <= max;

  const major = [
    { lat: [40.45, 40.95], lon: [-74.3, -73.65] },
    { lat: [33.6, 34.4], lon: [-118.7, -117.7] },
    { lat: [41.6, 42.2], lon: [-88.1, -87.3] },
    { lat: [29.4, 30.2], lon: [-95.9, -95.0] },
    { lat: [32.6, 33.1], lon: [-97.1, -96.4] }
  ];

  for (const box of major) {
    if (inRange(box.lat[0], box.lat[1], point.lat) && inRange(box.lon[0], box.lon[1], point.lon)) {
      return "major-metro";
    }
  }

  const metro = [
    { lat: [47.4, 47.85], lon: [-122.45, -122.1] },
    { lat: [37.55, 37.95], lon: [-122.6, -121.8] },
    { lat: [39.5, 40.1], lon: [-105.25, -104.55] },
    { lat: [25.5, 26.1], lon: [-80.4, -80.0] },
    { lat: [38.75, 39.1], lon: [-77.25, -76.8] }
  ];

  for (const box of metro) {
    if (inRange(box.lat[0], box.lat[1], point.lat) && inRange(box.lon[0], box.lon[1], point.lon)) {
      return "metro";
    }
  }

  return "non-metro";
}

function severityFromWind(mph?: number | null): SeverityKey {
  if (mph == null) return "low";
  if (mph >= 120) return "high";
  if (mph >= 100) return "medium";
  return "low";
}

function severityFromSnow(cm?: number | null): SeverityKey {
  if (cm == null) return "low";
  if (cm >= 100) return "high";
  if (cm >= 40) return "medium";
  return "low";
}

export function buildAdvancedSignals(args: {
  point: { lat: number; lon: number };
  fema?: FEMAData;
  soils?: SoilData;
  elevation?: ElevationSummary;
  climate?: ClimateData;
}): Signal[] {
  const signals: Signal[] = [];

  const windSeverity = severityFromWind(args.climate?.designWindMph ?? null);
  signals.push({
    id: "wind-load-proxy",
    label: "Wind Load Proxy",
    value: args.climate?.designWindMph != null ? `${fmt(args.climate.designWindMph, 0)} mph` : "Not available",
    severity: windSeverity,
    explanation: "5-year daily wind maxima proxy for envelope and lateral detailing sensitivity."
  });

  const snowSeverity = severityFromSnow(args.climate?.p90AnnualSnowCm ?? args.climate?.annualSnowCm ?? null);
  signals.push({
    id: "snow-load-proxy",
    label: "Snow Load Proxy",
    value:
      args.climate?.p90AnnualSnowCm != null
        ? `${fmt(args.climate.p90AnnualSnowCm, 0)} cm/yr (P90 annual)`
        : args.climate?.annualSnowCm != null
          ? `${fmt(args.climate.annualSnowCm, 0)} cm/yr`
          : "Not available",
    severity: snowSeverity,
    explanation: "Annualized snowfall proxy from historical series, weighted to upper-percentile snow exposure."
  });

  let wetlandScore = 0;
  const floodZone = args.fema?.floodZone ?? "";
  const hydro = args.soils?.hydrologicGroup ?? "";
  const drainage = (args.soils?.drainageClass ?? "").toLowerCase();
  if (floodZone.startsWith("A") || floodZone.startsWith("V")) wetlandScore += 2;
  if (hydro.includes("D")) wetlandScore += 1;
  if (drainage.includes("poor")) wetlandScore += 1;

  const wetlandSeverity: SeverityKey = wetlandScore >= 3 ? "high" : wetlandScore >= 2 ? "medium" : "low";
  signals.push({
    id: "wetland-constraint-proxy",
    label: "Wetland/Environmental Constraint Proxy",
    value: wetlandScore >= 3 ? "Elevated" : wetlandScore >= 2 ? "Moderate" : "Limited",
    severity: wetlandSeverity,
    explanation: "Proxy derived from flood and soil wetness indicators to flag potential environmental permitting friction."
  });

  const metro = metroClass(args.point);
  const utilitySeverity: SeverityKey = metro === "major-metro" ? "low" : metro === "metro" ? "medium" : "high";
  signals.push({
    id: "utility-capacity-proxy",
    label: "Utility Capacity/Proximity Proxy",
    value: metro === "major-metro" ? "Dense utility corridor" : metro === "metro" ? "Mixed availability" : "Limited utility context",
    severity: utilitySeverity,
    explanation: "Location context proxy for extension scope and lead-time risk of utility coordination."
  });

  const slope = args.elevation?.slopePercent ?? null;
  const metroPermitPenalty = metro === "major-metro" ? 2 : metro === "metro" ? 1 : 0;
  const floodPenalty = floodZone.startsWith("A") || floodZone.startsWith("V") ? 1 : 0;
  const permitScore = metroPermitPenalty + floodPenalty;
  const permitSeverity: SeverityKey = permitScore >= 3 ? "high" : permitScore >= 1 ? "medium" : "low";
  signals.push({
    id: "permitting-complexity-proxy",
    label: "Permitting Complexity Proxy",
    value: permitSeverity === "high" ? "Complex multi-review" : permitSeverity === "medium" ? "Moderate review path" : "Standard review path",
    severity: permitSeverity,
    explanation: "Proxy combining metropolitan review burden and environmental sensitivity factors."
  });

  const logisticsScore =
    (slope != null && slope >= 8 ? 2 : slope != null && slope >= 4 ? 1 : 0) +
    (utilitySeverity === "high" ? 1 : 0) +
    (wetlandSeverity === "high" ? 1 : 0);
  const logisticsSeverity: SeverityKey = logisticsScore >= 3 ? "high" : logisticsScore >= 1 ? "medium" : "low";
  signals.push({
    id: "logistics-access-proxy",
    label: "Logistics/Access Constraint Proxy",
    value: logisticsSeverity === "high" ? "Constrained" : logisticsSeverity === "medium" ? "Manageable constraints" : "Favorable access",
    severity: logisticsSeverity,
    explanation: "Proxy for staging, haul routes, and access complexity from terrain + context indicators."
  });

  return signals;
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function triangularSample(min: number, max: number, mode: number, rng: () => number): number {
  if (max <= min) return min;
  const u = rng();
  const split = (mode - min) / (max - min);
  if (u < split) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toTriple(p10: number, p50: number, p90: number): PercentileTriple {
  return {
    p10: round2(p10),
    p50: round2(p50),
    p90: round2(p90)
  };
}

export function buildProbabilisticEstimate(args: {
  costDrivers: CostDriver[];
  baselineCostUsd?: number;
  seedKey: string;
  sampleSize?: number;
}): ProbabilisticEstimate {
  const sampleSize = args.sampleSize ?? 2000;
  const rng = createRng(hashSeed(args.seedKey));

  const pctTotals: number[] = [];
  const dayTotals: number[] = [];

  for (let i = 0; i < sampleSize; i++) {
    let pctSum = 0;
    let daySum = 0;
    for (const driver of args.costDrivers) {
      const pctMin = driver.estimatedCostDeltaPct.min;
      const pctMax = driver.estimatedCostDeltaPct.max;
      const pctMode = (pctMin + pctMax) / 2;
      const dayMin = driver.estimatedScheduleDeltaDays.min;
      const dayMax = driver.estimatedScheduleDeltaDays.max;
      const dayMode = (dayMin + dayMax) / 2;
      pctSum += triangularSample(pctMin, pctMax, pctMode, rng);
      daySum += triangularSample(dayMin, dayMax, dayMode, rng);
    }
    pctTotals.push(pctSum);
    dayTotals.push(daySum);
  }

  pctTotals.sort((a, b) => a - b);
  dayTotals.sort((a, b) => a - b);

  const impactPct = toTriple(
    percentile(pctTotals, 10),
    percentile(pctTotals, 50),
    percentile(pctTotals, 90)
  );

  const scheduleDays = toTriple(
    percentile(dayTotals, 10),
    percentile(dayTotals, 50),
    percentile(dayTotals, 90)
  );

  const result: ProbabilisticEstimate = {
    baselineCostUsd: args.baselineCostUsd,
    impactPct,
    scheduleDays,
    methodology: "Monte Carlo using triangular distributions derived from each cost-driver min/max range.",
    sampleSize
  };

  if (args.baselineCostUsd && args.baselineCostUsd > 0) {
    const toUsd = (pct: number) => round2((pct / 100) * args.baselineCostUsd!);
    result.impactCostUsd = {
      p10: toUsd(impactPct.p10),
      p50: toUsd(impactPct.p50),
      p90: toUsd(impactPct.p90)
    };
  }

  return result;
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
