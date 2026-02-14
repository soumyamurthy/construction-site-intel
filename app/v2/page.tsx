"use client";

import { useMemo, useState } from "react";
import type { Signal } from "../../lib/types";
import type { V2AnalysisResult } from "../../lib/types-v2";

const DEFAULT_ADDRESS = "300 E Lincoln Way, Ames, IA 50010";

type TabId = "signals" | "cost" | "actions" | "report";

type SignalGroup = {
  key: string;
  title: string;
  subtitle: string;
  ids: string[];
};

const IMPORTANT_SIGNAL_GROUPS: SignalGroup[] = [
  {
    key: "regulatory",
    title: "Regulatory and Environmental",
    subtitle: "Permitting, flood, fire, and environmental exposure",
    ids: ["flood-zone", "wetland-constraint-proxy", "wildfire-risk", "permitting-complexity-proxy"]
  },
  {
    key: "structural",
    title: "Structural and Climate Loads",
    subtitle: "Code-driven structural loading and lateral demands",
    ids: ["sdc", "sds", "sd1", "wind-load-proxy", "snow-load-proxy"]
  },
  {
    key: "ground",
    title: "Ground and Site Conditions",
    subtitle: "Subgrade quality, slope, and constructability drivers",
    ids: ["soil-drainage", "clay", "site-slope", "utility-capacity-proxy", "logistics-access-proxy"]
  }
];

function groupImportantSignals(signals: Signal[]): Array<SignalGroup & { signals: Signal[] }> {
  return IMPORTANT_SIGNAL_GROUPS.map((group) => ({
    ...group,
    signals: group.ids
      .map((id) => signals.find((signal) => signal.id === id))
      .filter((signal): signal is Signal => Boolean(signal))
  })).filter((group) => group.signals.length > 0);
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

export default function V2Page() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [baselineCostUsd, setBaselineCostUsd] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<V2AnalysisResult | null>(null);

  const topDrivers = useMemo(() => data?.costDrivers.slice(0, 5) ?? [], [data]);
  const groupedImportantSignals = useMemo(
    () => (data ? groupImportantSignals(data.signals) : []),
    [data]
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          baselineCostUsd: baselineCostUsd ? Number(baselineCostUsd) : undefined
        })
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
    <main>
      <section className="hero">
        <div>
          <span className="tag">Site Intel V2 - Estimator + PM Workflow</span>
          <h1>Pre-bid cost drivers, contingency guidance, and action ownership.</h1>
        </div>
        <div className="card fade-in">
          <form className="form" onSubmit={handleSubmit}>
            <label className="address-label">Site Address</label>
            <input
              className="address-input"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="123 Main St, City, ST 12345"
            />
            <input
              className="address-input"
              type="number"
              min={0}
              step="1000"
              value={baselineCostUsd}
              onChange={(event) => setBaselineCostUsd(event.target.value)}
              placeholder="Optional baseline project cost (USD)"
            />
            <button type="submit" className="submit-button" disabled={loading}>
              {loading ? "Analyzing..." : "Run V2 Analysis"}
            </button>
            <div className="v2-links-row">
              <a href="/">Demo Home</a>
              <a href="/v1">Open V1 Demo</a>
              {data && (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => downloadFile("site-intel-v2.json", JSON.stringify(data, null, 2), "application/json")}
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => downloadFile("site-intel-v2.csv", toCsv(data), "text/csv")}
                  >
                    Export CSV
                  </button>
                </>
              )}
            </div>
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
            <div className="section-title">Pre-Bid Summary</div>
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
            <div className="card">
              <div className="section-title">Critical Signals</div>
              <div className="v2-signal-groups">
                {groupedImportantSignals.map((group) => (
                  <section key={group.key} className="v2-signal-group">
                    <header className="v2-group-header">
                      <h3>{group.title}</h3>
                      <p>{group.subtitle}</p>
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
                ))}
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
                      <tr key={d.id}>
                        <td>{d.label}</td>
                        <td>{d.severity}</td>
                        <td>{d.costCategory}</td>
                        <td>{d.estimatedCostDeltaPct.min}% - {d.estimatedCostDeltaPct.max}%</td>
                        <td>{d.estimatedScheduleDeltaDays.min} - {d.estimatedScheduleDeltaDays.max} days</td>
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
                  <div key={action.id} className="implication-card">
                    <h4>{action.title}</h4>
                    <p>Owner: {action.owner}</p>
                    <p>Due: {action.duePhase}</p>
                    <p>Lead Time: {action.leadTimeDays} days</p>
                    <p>Priority: {action.priority}</p>
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
                  <li key={driver.id}>
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
                {data.warnings.length === 0 && <li>No source warnings detected.</li>}
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
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
