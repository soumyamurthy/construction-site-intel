import { AnalysisResult } from "./types";

export type ImpactType = "capex" | "general_conditions" | "insurance" | "schedule";

export type CostDriver = {
  id: string;
  signalId: string;
  label: string;
  severity: "low" | "medium" | "high";
  costCategory: string;
  impactType: ImpactType;
  estimatedCostDeltaPct: { min: number; max: number };
  estimatedScheduleDeltaDays: { min: number; max: number };
  rationale: string;
};

export type PMAction = {
  id: string;
  title: string;
  owner: "Estimator" | "Project Manager" | "Civil Engineer" | "Structural Engineer" | "Geotech";
  duePhase: "Bid" | "Design Development" | "Permit" | "Procurement" | "Mobilization";
  leadTimeDays: number;
  priority: "high" | "medium" | "low";
  relatedSignalId: string;
};

export type BidAssumption = {
  title: string;
  text: string;
  type: "assumption" | "allowance" | "exclusion";
};

export type ContingencyRange = {
  minPct: number;
  maxPct: number;
  basis: string;
};

export type V2AnalysisResult = AnalysisResult & {
  version: "v2";
  confidenceScore: number;
  dataCompletenessPct: number;
  contingency: ContingencyRange;
  costDrivers: CostDriver[];
  actions: PMAction[];
  bidAssumptions: BidAssumption[];
};
