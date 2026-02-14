export default function Home() {
  return (
    <main>
      <section className="hero">
        <div>
          <span className="tag">Site Intel Demo Hub</span>
          <h1>Choose the version you want to demo.</h1>
          <p>
            V1 is your original signal-focused workflow. V2 adds estimator and project-manager tooling
            including cost impacts, contingency guidance, and action ownership.
          </p>
        </div>
        <div className="card fade-in">
          <div className="section-title">Available Demos</div>
          <div className="implications-grid">
            <a className="implication-card" href="/v1">
              <h4>V1 - Signal Intelligence</h4>
              <p>Original version with categorized risk/design signals and implications.</p>
            </a>
            <a className="implication-card" href="/v2">
              <h4>V2 - Estimator + PM</h4>
              <p>Cost driver register, contingency range, PM actions, and pre-bid brief exports.</p>
            </a>
          </div>
          <div className="notice" style={{ marginTop: "12px" }}>
            Tip: Start with the same address in both versions to show the evolution clearly.
          </div>
        </div>
      </section>

      <div className="footer">Construction Site Intelligence POC</div>
    </main>
  );
}
