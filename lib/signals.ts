import { FEMAData, SoilData, USGSDesignData, ElevationSummary, FireHazardData } from "./sources";
import { Implication, Signal } from "./types";

function severityFromFloodZone(zone?: string): Signal["severity"] {
  if (!zone) return "unknown";
  if (zone.startsWith("A") || zone.startsWith("V")) return "high";
  if (zone.startsWith("X") || zone.startsWith("B") || zone.startsWith("C")) return "low";
  return "medium";
}

function severityFromFireRisk(risk?: string): Signal["severity"] {
  if (!risk) return "low";
  if (risk === "very high") return "high";
  if (risk === "high") return "high";
  if (risk === "medium") return "medium";
  return "low";
}

function severityFromSdc(sdc?: string): Signal["severity"] {
  if (!sdc) return "low";
  if (["D", "E", "F"].includes(sdc)) return "high";
  if (sdc === "C") return "medium";
  return "low";
}

function severityFromHydroGroup(group?: string): Signal["severity"] {
  if (!group) return "low";
  if (group.includes("D")) return "high";
  if (group.includes("C")) return "medium";
  return "low";
}

function severityFromDrainageClass(value?: string): Signal["severity"] {
  if (!value) return "low";
  const v = value.toLowerCase();
  if (v.includes("poor") || v.includes("very poor")) return "high";
  if (v.includes("somewhat") || v.includes("moderate")) return "medium";
  return "low";
}

function severityFromClay(clay?: number | null): Signal["severity"] {
  if (clay == null) return "low";
  if (clay >= 40) return "high";
  if (clay >= 25) return "medium";
  return "low";
}

function severityFromRestrictiveDepth(depth?: number | null): Signal["severity"] {
  if (depth == null) return "low";
  if (depth <= 100) return "high";
  if (depth <= 150) return "medium";
  return "low";
}

function severityFromSlope(slope?: number | null): Signal["severity"] {
  if (slope == null) return "low";
  if (slope >= 10) return "high";
  if (slope >= 5) return "medium";
  return "low";
}

function formatNumber(value?: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return value.toFixed(digits);
}

export function buildSignals(args: {
  fema?: FEMAData;
  usgs?: USGSDesignData;
  soils?: SoilData;
  elevation?: ElevationSummary;
  fire?: FireHazardData;
}): Signal[] {
  const signals: Signal[] = [];

  signals.push({
    id: "flood-zone",
    label: "Flood Hazard Zone",
    value: args.fema?.floodZone ?? "Unknown",
    severity: severityFromFloodZone(args.fema?.floodZone),
    explanation: "FEMA NFHL zone indicates insurance and elevation-driven design requirements."
  });

  signals.push({
    id: "base-flood-elevation",
    label: "Base Flood Elevation",
    value: args.fema?.staticBfe != null ? `${args.fema?.staticBfe} ft` : "Not applicable",
    severity: args.fema?.staticBfe != null ? "medium" : "low",
    explanation: args.fema?.staticBfe != null
      ? "BFE informs minimum finished floor and floodproofing elevation."
      : "No BFE required for this location (outside mapped flood areas)."
  });

  signals.push({
    id: "sdc",
    label: "Seismic Design Category",
    value: args.usgs?.sdc ?? "Not available",
    severity: severityFromSdc(args.usgs?.sdc),
    explanation: args.usgs?.sdc
      ? `SDC ${args.usgs.sdc}: Higher categories drive increased lateral force design complexity and detailing costs.`
      : "Seismic design parameters could not be determined from USGS."
  });

  signals.push({
    id: "sds",
    label: "Short-Period Spectral Accel (SDS)",
    value: args.usgs?.sds != null ? formatNumber(args.usgs.sds, 3) : "Not available",
    severity: args.usgs?.sds != null ? (args.usgs.sds >= 1.0 ? "high" : "low") : "low",
    explanation: args.usgs?.sds != null
      ? "Higher SDS increases seismic base shear and foundation demand."
      : "Seismic acceleration parameters not determined."
  });

  signals.push({
    id: "sd1",
    label: "1-Second Spectral Accel (SD1)",
    value: args.usgs?.sd1 != null ? formatNumber(args.usgs.sd1, 3) : "Not available",
    severity: args.usgs?.sd1 != null ? (args.usgs.sd1 >= 0.6 ? "high" : "low") : "low",
    explanation: args.usgs?.sd1 != null
      ? "Higher SD1 drives drift-sensitive system sizing and bracing."
      : "Seismic acceleration parameters not determined."
  });

  signals.push({
    id: "soil-drainage",
    label: "Soil Drainage Class",
    value: args.soils?.drainageClass ?? "Not available",
    severity: severityFromDrainageClass(args.soils?.drainageClass),
    explanation: args.soils?.drainageClass
      ? "Poor drainage elevates earthwork, dewatering, and slab moisture risk."
      : "Soil drainage class data not available."
  });

  signals.push({
    id: "hydro-group",
    label: "Soil Hydrologic Group",
    value: args.soils?.hydrologicGroup ?? "Not available",
    severity: severityFromHydroGroup(args.soils?.hydrologicGroup),
    explanation: args.soils?.hydrologicGroup
      ? "Hydrologic group indicates runoff potential affecting stormwater design."
      : "Hydrologic group data not available."
  });

  signals.push({
    id: "clay",
    label: "Surface Clay Content",
    value: args.soils?.clayPercent != null ? `${formatNumber(args.soils?.clayPercent, 0)}%` : "Not available",
    severity: severityFromClay(args.soils?.clayPercent ?? null),
    explanation: args.soils?.clayPercent != null
      ? "Higher clay content raises shrink-swell and slab movement risk."
      : "Clay content data not available."
  });

  signals.push({
    id: "restrictive-depth",
    label: "Restrictive Layer Depth",
    value: args.soils?.restrictiveDepthCm != null ? `${formatNumber(args.soils?.restrictiveDepthCm, 0)} cm` : "Not available",
    severity: severityFromRestrictiveDepth(args.soils?.restrictiveDepthCm ?? null),
    explanation: args.soils?.restrictiveDepthCm != null
      ? "Shallow restrictive layers increase excavation difficulty and foundation cost."
      : "Restrictive layer depth data not available."
  });

  signals.push({
    id: "site-slope",
    label: "Local Slope (Approx)",
    value: args.elevation?.slopePercent != null ? `${formatNumber(args.elevation?.slopePercent, 1)}%` : "Not available",
    severity: severityFromSlope(args.elevation?.slopePercent ?? null),
    explanation: args.elevation?.slopePercent != null
      ? "Higher slope increases grading, retaining, and erosion control needs."
      : "Slope data could not be calculated."
  });

  signals.push({
    id: "wildfire-risk",
    label: "Wildfire Risk",
    value: args.fire?.wildfireRisk ?? "Not available",
    severity: severityFromFireRisk(args.fire?.wildfireRisk),
    explanation: args.fire?.wildfireRisk
      ? `Wildfire risk: ${args.fire.wildfireRisk}. Higher risk affects defensibility, insurance, and long-term viability.`
      : "Wildfire risk data not available for this location."
  });

  return signals;
}

export function buildImplications(signals: Signal[]): Implication[] {
  const implications: Implication[] = [];

  const flood = signals.find((s) => s.id === "flood-zone");
  if (flood?.severity === "high") {
    implications.push({
      title: "Flood Mitigation Budget",
      detail: "Allocate contingency for elevation, floodproofing, and potential insurance premiums."
    });
  }

  const seismic = signals.find((s) => s.id === "sdc");
  if (seismic?.severity === "high") {
    implications.push({
      title: "Structural Seismic Premium",
      detail: "Expect higher lateral system cost, detailing complexity, and review time."
    });
  }

  const drainage = signals.find((s) => s.id === "soil-drainage");
  if (drainage?.severity === "high") {
    implications.push({
      title: "Dewatering & Subgrade",
      detail: "Plan for dewatering, subgrade stabilization, and moisture protection for slabs."
    });
  }

  const clay = signals.find((s) => s.id === "clay");
  if (clay?.severity === "high") {
    implications.push({
      title: "Expansive Soil Controls",
      detail: "Consider moisture conditioning, thicker slabs, and jointing strategy."
    });
  }

  const slope = signals.find((s) => s.id === "site-slope");
  if (slope?.severity === "high") {
    implications.push({
      title: "Grading & Retaining",
      detail: "Budget for cut/fill, slope stabilization, and erosion controls."
    });
  }

  const fire = signals.find((s) => s.id === "wildfire-risk");
  if (fire?.severity === "high") {
    implications.push({
      title: "Fire Defensibility & Insurance",
      detail: "Consider defensible space, fire-resistant materials, and specialized insurance requirements."
    });
  }

  if (!implications.length) {
    implications.push({
      title: "Baseline Controls",
      detail: "No extreme signals detected. Proceed with standard geotech validation."
    });
  }

  return implications;
}
