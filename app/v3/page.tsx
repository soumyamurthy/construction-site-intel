"use client";

import { useEffect, useMemo, useState } from "react";
import type { Signal } from "../../lib/types";
import type { V2AnalysisResult } from "../../lib/types-v2";

const DEFAULT_ADDRESS = "300 E Lincoln Way, Ames, IA 50010";

type TabId = "signals" | "cost" | "actions" | "report";

type SignalGroup = {
  key: string;
  title: string;
  icon: string;
  subtitle: string;
  ids: string[];
};

const IMPORTANT_SIGNAL_GROUPS: SignalGroup[] = [
  {
    key: "flood",
    title: "Flood Hazards",
    icon: "💧",
    subtitle: "Floodplain status, elevation requirements, and environmental wetness constraints",
    ids: ["flood-zone", "base-flood-elevation", "wetland-constraint-proxy"]
  },
  {
    key: "seismic",
    title: "Seismic",
    icon: "⚡",
    subtitle: "Code-driven lateral demands and seismic design criteria",
    ids: ["sdc", "sds", "sd1"]
  },
  {
    key: "climate-loads",
    title: "Wind & Snow",
    icon: "🌨️",
    subtitle: "Weather-driven loading conditions affecting envelope and structure",
    ids: ["wind-load-proxy", "snow-load-proxy"]
  },
  {
    key: "soils",
    title: "Soils",
    icon: "🏔️",
    subtitle: "Drainage, hydrology, clay content, and subsurface restrictions",
    ids: ["soil-drainage", "hydro-group", "clay", "restrictive-depth"]
  },
  {
    key: "terrain-logistics",
    title: "Terrain & Logistics",
    icon: "🗻",
    subtitle: "Topography, access constraints, and utility context",
    ids: ["site-slope", "logistics-access-proxy", "utility-capacity-proxy"]
  },
  {
    key: "environmental",
    title: "Environmental & Permitting",
    icon: "🔥",
    subtitle: "Wildfire exposure and review-path complexity",
    ids: ["wildfire-risk", "permitting-complexity-proxy"]
  }
];

function groupAllSignals(signals: Signal[]): Array<SignalGroup & { signals: Signal[] }> {
  const grouped = IMPORTANT_SIGNAL_GROUPS.map((group) => ({
    ...group,
    signals: group.ids
      .map((id) => signals.find((signal) => signal.id === id))
      .filter((signal): signal is Signal => Boolean(signal))
  })).filter((group) => group.signals.length > 0);

  const groupedIds = new Set(grouped.flatMap((group) => group.signals.map((signal) => signal.id)));
  const uncategorizedSignals = signals.filter((signal) => !groupedIds.has(signal.id));

  if (uncategorizedSignals.length > 0) {
    grouped.push({
      key: "other",
      title: "Additional Signals",
      icon: "📌",
      subtitle: "",
      ids: uncategorizedSignals.map((signal) => signal.id),
      signals: uncategorizedSignals
    });
  }

  return grouped;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(data: V2AnalysisResult): string {
  const rows: string[] = [];
  rows.push("Section,Field,Value");
  rows.push(`Summary,Address,${escapeCsv(data.address)}`);
  rows.push(`Summary,Confidence Score,${data.confidenceScore}`);
  rows.push(`Summary,Data Completeness %,${data.dataCompletenessPct}`);
  rows.push(`Summary,Contingency Min %,${data.contingency.minPct}`);
  rows.push(`Summary,Contingency Max %,${data.contingency.maxPct}`);
  rows.push(`Summary,P10 Cost Impact %,${data.probabilisticEstimate.impactPct.p10}`);
  rows.push(`Summary,P50 Cost Impact %,${data.probabilisticEstimate.impactPct.p50}`);
  rows.push(`Summary,P90 Cost Impact %,${data.probabilisticEstimate.impactPct.p90}`);
  rows.push(`Summary,P10 Schedule Days,${data.probabilisticEstimate.scheduleDays.p10}`);
  rows.push(`Summary,P50 Schedule Days,${data.probabilisticEstimate.scheduleDays.p50}`);
  rows.push(`Summary,P90 Schedule Days,${data.probabilisticEstimate.scheduleDays.p90}`);
  if (data.probabilisticEstimate.impactCostUsd) {
    rows.push(`Summary,P10 Cost Impact USD,${data.probabilisticEstimate.impactCostUsd.p10}`);
    rows.push(`Summary,P50 Cost Impact USD,${data.probabilisticEstimate.impactCostUsd.p50}`);
    rows.push(`Summary,P90 Cost Impact USD,${data.probabilisticEstimate.impactCostUsd.p90}`);
  }

  for (const d of data.costDrivers) {
    rows.push(`Cost Driver,Label,${escapeCsv(d.label)}`);
    rows.push(`Cost Driver,Severity,${d.severity}`);
    rows.push(`Cost Driver,Cost Category,${escapeCsv(d.costCategory)}`);
    rows.push(`Cost Driver,Cost Impact %,${d.estimatedCostDeltaPct.min}-${d.estimatedCostDeltaPct.max}`);
    rows.push(`Cost Driver,Schedule Days,${d.estimatedScheduleDeltaDays.min}-${d.estimatedScheduleDeltaDays.max}`);
  }

  for (const a of data.actions) {
    rows.push(`PM Action,Title,${escapeCsv(a.title)}`);
    rows.push(`PM Action,Owner,${a.owner}`);
    rows.push(`PM Action,Due Phase,${a.duePhase}`);
    rows.push(`PM Action,Lead Time Days,${a.leadTimeDays}`);
    rows.push(`PM Action,Priority,${a.priority}`);
  }

  return rows.join("\n");
}

export default function V3Page() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<V2AnalysisResult | null>(null);
  const [recentAddresses, setRecentAddresses] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  const topDrivers = useMemo(() => data?.costDrivers.slice(0, 5) ?? [], [data]);
  const groupedSignals = useMemo(
    () => (data ? groupAllSignals(data.signals) : []),
    [data]
  );

  useEffect(() => {
    document.body.classList.add("v2-body");
    return () => {
      document.body.classList.remove("v2-body");
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("recentAddressesV3");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
        setRecentAddresses(valid.slice(0, 8));
      }
    } catch {
      // Ignore malformed localStorage value.
    }
  }, []);

  useEffect(() => {
    if (!data || !address.trim()) return;
    const currentAddress = address.trim();
    setRecentAddresses((prev) => {
      const deduped = prev.filter((item) => item !== currentAddress);
      const updated = [currentAddress, ...deduped].slice(0, 8);
      localStorage.setItem("recentAddressesV3", JSON.stringify(updated));
      return updated;
    });
  }, [data, address]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address })
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Request failed");
      }
      setData(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to run V2 analysis";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="v2-page v3-page">
      <section className="hero v2-hero">
        <div className="v2-hero-copy">
          <span className="tag">Estimator + PM Intelligence</span>
          <h1>Construction Site Intelligence</h1>
          <p>Pre-bid cost drivers, contingency guidance, and action ownership.</p>
          <p>Includes AI-assisted deductions layered on source data to accelerate early-stage estimating decisions.</p>
        </div>
        <div className="card fade-in v2-hero-card">
          <form className="form v2-hero-form" onSubmit={handleSubmit}>
            <label className="address-label v2-address-label">Site Address</label>
            <div className="v2-input-row">
              <div className="input-container v2-input-container">
                <input
                  className="address-input v2-hero-input"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  onFocus={() => setShowRecent(true)}
                  onBlur={() => setTimeout(() => setShowRecent(false), 150)}
                  placeholder="123 Main St, City, ST 12345"
                  autoComplete="off"
                />
                {recentAddresses.length > 0 && showRecent && (
                  <div className="recent-addresses-dropdown v2-recent-dropdown">
                    {recentAddresses.map((addr) => (
                      <button
                        key={addr}
                        type="button"
                        className="recent-address-item"
                        onClick={() => {
                          setAddress(addr);
                          setShowRecent(false);
                        }}
                      >
                        <span className="recent-icon">⏱️</span>
                        <span>{addr}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit" className="submit-button v2-hero-button" disabled={loading}>
                {loading ? "Analyzing..." : "Run V2 Analysis"}
              </button>
            </div>
            {data && (
              <div className="v2-export-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => downloadFile("site-intel-v3.json", JSON.stringify(data, null, 2), "application/json")}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => downloadFile("site-intel-v3.csv", toCsv(data), "text/csv")}
                >
                  Export CSV
                </button>
              </div>
            )}
          </form>
        </div>
      </section>

      {error && (
        <div className="card error-card">
          <div className="section-title">V2 Analysis Failed</div>
          <p>{error}</p>
        </div>
      )}

      {data && (
        <section className="fade-in">
          <div className="card">
            <div className="section-title">Summary</div>
            <div className="v2-metrics-grid">
              <div className="v2-metric">
                <div>Confidence Score</div>
                <strong>{data.confidenceScore}/100</strong>
              </div>
              <div className="v2-metric">
                <div>Data Completeness</div>
                <strong>{data.dataCompletenessPct}%</strong>
              </div>
              <div className="v2-metric">
                <div>Recommended Contingency</div>
                <strong>{data.contingency.minPct}% - {data.contingency.maxPct}%</strong>
              </div>
              <div className="v2-metric">
                <div>Contingency Basis</div>
                <strong>{data.contingency.basis}</strong>
              </div>
              <div className="v2-metric">
                <div>P50 Cost Impact</div>
                <strong>
                  +{data.probabilisticEstimate.impactPct.p50}%
                  {data.probabilisticEstimate.impactCostUsd
                    ? ` ($${Math.round(data.probabilisticEstimate.impactCostUsd.p50).toLocaleString()})`
                    : ""}
                </strong>
              </div>
              <div className="v2-metric">
                <div>P90 Schedule Impact</div>
                <strong>{data.probabilisticEstimate.scheduleDays.p90} days</strong>
              </div>
            </div>
          </div>

          <div className="v2-tabs">
            {(["signals", "cost", "actions", "report"] as TabId[]).map((tab) => (
              <button
                key={tab}
                className={tab === activeTab ? "tab-button active" : "tab-button"}
                type="button"
                onClick={() => setActiveTab(tab)}
              >
                {tab === "signals" && "Signals"}
                {tab === "cost" && "Cost Impacts"}
                {tab === "actions" && "PM Actions"}
                {tab === "report" && "Pre-Bid Brief"}
              </button>
            ))}
          </div>

          {activeTab === "signals" && (
            <div className="fade-in">
              <h2 className="section-header">Risk & Design Signals</h2>
              <div className="v2-signals-scroll">
                <div className="signal-groups">
                  {groupedSignals.map((group) => {
                    const hasHighSeverity = group.signals.some((signal) => signal.severity === "high");

                    return (
                      <section key={group.key} className="signal-group" data-high={hasHighSeverity}>
                        <header className="group-header">
                          <span className="group-icon">{group.icon}</span>
                          <div className="v2-group-heading">
                            <h3>{group.title}</h3>
                            <p className="group-subtitle">{group.subtitle}</p>
                          </div>
                          {hasHighSeverity && <span className="alert-badge">⚠️ High</span>}
                        </header>
                        <div className="signals-list">
                          {group.signals.map((signal) => (
                            <div key={signal.id} className={`signal-item severity-${signal.severity}`}>
                              <div className="signal-header">
                                <span className="signal-name">{signal.label}</span>
                                <span className={`severity-badge severity-${signal.severity}`}>{signal.severity}</span>
                              </div>
                              <div className="signal-value">{signal.value}</div>
                              <p className="signal-explanation">{signal.explanation}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "cost" && (
            <div className="card">
              <div className="section-title">Cost Driver Register</div>
              <div className="v2-table-wrap">
                <table className="v2-table">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Severity</th>
                      <th>Category</th>
                      <th>Cost Impact</th>
                      <th>Schedule Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.costDrivers.map((d) => (
                      <tr key={d.id} className={`severity-row severity-${d.severity}`}>
                        <td className="driver-cell">{d.label}</td>
                        <td><span className={`severity-badge severity-${d.severity}`}>{d.severity}</span></td>
                        <td>{d.costCategory}</td>
                        <td className="impact-cell">{d.estimatedCostDeltaPct.min}% - {d.estimatedCostDeltaPct.max}%</td>
                        <td className="impact-cell">{d.estimatedScheduleDeltaDays.min} - {d.estimatedScheduleDeltaDays.max} days</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "actions" && (
            <div className="card">
              <div className="section-title">PM Action Register</div>
              <div className="implications-grid">
                {data.actions.map((action) => (
                  <div key={action.id} className={`implication-card priority-${action.priority}`}>
                    <h4>{action.title}</h4>
                    <p>Owner: {action.owner}</p>
                    <p>Due: {action.duePhase}</p>
                    <p>Lead Time: {action.leadTimeDays} days</p>
                    <p className={`priority-line priority-${action.priority}`}>Priority: {action.priority}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "report" && (
            <div className="card">
              <div className="section-title">Pre-Bid Brief</div>
              <h3>Top Cost Drivers</h3>
              <ul className="v2-list">
                {topDrivers.map((driver) => (
                  <li key={driver.id} className={`severity-line severity-${driver.severity}`}>
                    <span className={`severity-badge severity-${driver.severity}`}>{driver.severity}</span>{" "}
                    {driver.label}: +{driver.estimatedCostDeltaPct.min}% to +{driver.estimatedCostDeltaPct.max}% ({driver.rationale})
                  </li>
                ))}
              </ul>

              <h3>Bid Assumptions / Allowances / Exclusions</h3>
              <ul className="v2-list">
                {data.bidAssumptions.map((item) => (
                  <li key={item.title}><strong>{item.type.toUpperCase()}:</strong> {item.text}</li>
                ))}
              </ul>

              <h3>System Warnings</h3>
              <ul className="v2-list">
                {data.warnings.length === 0 && <li className="severity-line severity-low">No source warnings detected.</li>}
                {data.warnings.map((warning) => (
                  <li key={warning} className="severity-line severity-high">{warning}</li>
                ))}
              </ul>

              <h3>Probabilistic Range (P10 / P50 / P90)</h3>
              <ul className="v2-list">
                <li>
                  Cost Impact %: {data.probabilisticEstimate.impactPct.p10}% / {data.probabilisticEstimate.impactPct.p50}% / {data.probabilisticEstimate.impactPct.p90}%
                </li>
                <li>
                  Schedule Days: {data.probabilisticEstimate.scheduleDays.p10} / {data.probabilisticEstimate.scheduleDays.p50} / {data.probabilisticEstimate.scheduleDays.p90}
                </li>
                {data.probabilisticEstimate.impactCostUsd && (
                  <li>
                    Cost Impact USD: ${Math.round(data.probabilisticEstimate.impactCostUsd.p10).toLocaleString()} / ${Math.round(data.probabilisticEstimate.impactCostUsd.p50).toLocaleString()} / ${Math.round(data.probabilisticEstimate.impactCostUsd.p90).toLocaleString()}
                  </li>
                )}
                <li>{data.probabilisticEstimate.methodology}</li>
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
