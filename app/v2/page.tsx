"use client";

import { useMemo, useState } from "react";
import type { V2AnalysisResult } from "../../lib/types-v2";

const DEFAULT_ADDRESS = "300 E Lincoln Way, Ames, IA 50010";

type TabId = "signals" | "cost" | "actions" | "report";

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
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<V2AnalysisResult | null>(null);

  const topDrivers = useMemo(() => data?.costDrivers.slice(0, 5) ?? [], [data]);

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
    <main>
      <section className="hero">
        <div>
          <span className="tag">Site Intel V2 - Estimator + PM Workflow</span>
          <h1>Pre-bid cost drivers, contingency guidance, and action ownership.</h1>
          <p>Use this alongside V1 for demos. V1 runs at `/v1`, and this version runs at `/v2`.</p>
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
              <div className="section-title">Risk Signals</div>
              <div className="signals-list">
                {data.signals.map((signal) => (
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
            </div>
          )}
        </section>
      )}
    </main>
  );
}
