"use client";

import { useState } from "react";
import type { AnalysisResult, Signal } from "../lib/types";

const DEFAULT_ADDRESS = "3875 Reservoir Rd, Lima, OH 45801";

type SignalCategory = {
  name: string;
  icon: string;
  ids: string[];
  color: string;
};

const SIGNAL_CATEGORIES: SignalCategory[] = [
  {
    name: "Flood Hazards",
    icon: "💧",
    ids: ["flood-zone", "base-flood-elevation"],
    color: "#6fd6a4"
  },
  {
    name: "Seismic",
    icon: "⚡",
    ids: ["sdc", "sds", "sd1"],
    color: "#f1c86a"
  },
  {
    name: "Soils",
    icon: "🏔️",
    ids: ["soil-drainage", "hydro-group", "clay", "restrictive-depth"],
    color: "#8b7355"
  },
  {
    name: "Terrain",
    icon: "🗻",
    ids: ["site-slope"],
    color: "#9b8b6b"
  },
  {
    name: "Environmental",
    icon: "🔥",
    ids: ["wildfire-risk"],
    color: "#f08a7a"
  }
];

function groupSignals(signals: Signal[]): Map<string, Signal[]> {
  const grouped = new Map<string, Signal[]>();

  SIGNAL_CATEGORIES.forEach((cat) => {
    const catSignals = signals.filter((s) => cat.ids.includes(s.id));
    if (catSignals.length > 0) {
      grouped.set(cat.name, catSignals);
    }
  });

  return grouped;
}

export default function Home() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address })
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? "Request failed");
      }
      setData(payload);
    } catch (err: any) {
      setError(err?.message ?? "Failed to analyze site");
    } finally {
      setLoading(false);
    }
  }

  const groupedSignals = data ? groupSignals(data.signals) : new Map();
  const categoryOrder = SIGNAL_CATEGORIES.filter((c) => groupedSignals.has(c.name));

  return (
    <main>
      <section className="hero">
        <div>
          <span className="tag">Construction Site Intelligence POC</span>
          <h1>From location to cost, design, and risk signals.</h1>
          <p>
            Pulls authoritative environmental, geotechnical, and climate facts and
            normalizes them into actionable construction signals.
          </p>
        </div>
        <div className="card fade-in">
          <form className="form" onSubmit={handleSubmit}>
            <label>
              US Address
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="123 Main St, City, ST 12345"
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "Analyzing..." : "Run Analysis"}
            </button>
            <div className="notice">All sources used are free and unauthenticated.</div>
          </form>
        </div>
      </section>

      {error && (
        <div className="card error-card">
          <div className="section-title">❌ Analysis Failed</div>
          <p style={{ color: "var(--danger)", lineHeight: "1.6" }}>{error}</p>
          <div className="notice" style={{ marginTop: "12px", background: "rgba(240, 138, 122, 0.1)", borderColor: "rgba(240, 138, 122, 0.3)" }}>
            <strong>💡 Tips:</strong>
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
              <li>Try a simpler address format: "City, State ZIP"</li>
              <li>Make sure the address is in the US Census database</li>
              <li>Rural or new addresses may not geocode</li>
              <li>Example that works: "Davis, CA 95616"</li>
            </ul>
          </div>
        </div>
      )}

      {data && (
        <section className="fade-in">
          <div className="card">
            <div className="section-title">Summary</div>
            <p>
              <strong>{data.address}</strong>
              <br />
              <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                {data.location?.lat.toFixed(5)}, {data.location?.lon.toFixed(5)}
              </span>
            </p>
            {data.warnings.length > 0 && (
              <div className="notice">
                {data.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}
          </div>

          {/* Grouped Signals Section */}
          <div className="fade-in">
            <h2 className="section-header">Risk & Design Signals</h2>
            <div className="signal-groups">
              {categoryOrder.map((category) => {
                const signals: Signal[] = groupedSignals.get(category.name) || [];
                const hasHighSeverity = signals.some((s) => s.severity === "high");

                return (
                  <div key={category.name} className="signal-group" data-high={hasHighSeverity}>
                    <div className="group-header">
                      <span className="group-icon">{category.icon}</span>
                      <h3>{category.name}</h3>
                      {hasHighSeverity && <span className="alert-badge">⚠️ High</span>}
                    </div>
                    <div className="signals-list">
                      {signals.map((signal) => (
                        <div key={signal.id} className={`signal-item severity-${signal.severity}`}>
                          <div className="signal-header">
                            <span className="signal-name">{signal.label}</span>
                            <span className={`severity-badge severity-${signal.severity}`}>
                              {signal.severity}
                            </span>
                          </div>
                          <div className="signal-value">{signal.value}</div>
                          <p className="signal-explanation">{signal.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Implications */}
          <div className="card fade-in">
            <div className="section-title">💡 Cost & Risk Implications</div>
            <div className="implications-grid">
              {data.implications.map((implication) => (
                <div key={implication.title} className="implication-card">
                  <h4>{implication.title}</h4>
                  <p>{implication.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="footer">
        Sources: USGS Design Maps, USGS EPQS, FEMA NFHL, USDA NRCS SSURGO, US Census Geocoder.
      </div>
    </main>
  );
}
