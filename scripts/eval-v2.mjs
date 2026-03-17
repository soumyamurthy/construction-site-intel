const BASE_URL = process.env.EVAL_BASE_URL || "http://127.0.0.1:3000";
const ENDPOINT = `${BASE_URL}/api/analyze-v2`;

const CASES = [
  { name: "Ames", address: "300 E Lincoln Way, Ames, IA 50010" },
  { name: "Gainesville", address: "100 Main St, Gainesville, FL 32601" },
  { name: "Urbana", address: "1 University Ave, Urbana, IL 61801" },
  { name: "Inwood", address: "396 Development Drive, Inwood, WV 25428" }
];

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function summarizeFailure(name, reasons) {
  console.error(`FAIL ${name}`);
  for (const reason of reasons) {
    console.error(`  - ${reason}`);
  }
}

async function runCase(testCase) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: testCase.address })
  });

  const body = await response.json().catch(() => ({}));
  const reasons = [];

  if (!response.ok) {
    reasons.push(`HTTP ${response.status}: ${body?.error || "Unknown API error"}`);
    return { ok: false, reasons, body };
  }

  if (!body || typeof body !== "object") reasons.push("Response is not an object");
  if (!isFiniteNumber(body?.location?.lat)) reasons.push("Missing/invalid location.lat");
  if (!isFiniteNumber(body?.location?.lon)) reasons.push("Missing/invalid location.lon");
  if (!Array.isArray(body?.facts)) reasons.push("facts is not an array");
  if (!Array.isArray(body?.signals)) reasons.push("signals is not an array");
  if (!Array.isArray(body?.implications)) reasons.push("implications is not an array");
  if (!Array.isArray(body?.costDrivers)) reasons.push("costDrivers is not an array");
  if (!Array.isArray(body?.actions)) reasons.push("actions is not an array");
  if (!body?.contingency || typeof body.contingency !== "object") reasons.push("Missing contingency object");
  if (!isFiniteNumber(body?.confidenceScore)) reasons.push("Missing/invalid confidenceScore");
  if (!isFiniteNumber(body?.dataCompletenessPct)) reasons.push("Missing/invalid dataCompletenessPct");

  return { ok: reasons.length === 0, reasons, body };
}

async function waitForApi(maxAttempts = 30, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function main() {
  console.log(`Running V2 evals against ${ENDPOINT}`);
  const ready = await waitForApi();
  if (!ready) {
    console.error(`Could not reach ${BASE_URL}. Start the app first with: npm run dev`);
    process.exit(1);
  }

  let passCount = 0;
  const failures = [];

  for (const testCase of CASES) {
    try {
      const result = await runCase(testCase);
      if (result.ok) {
        passCount += 1;
        const warningsCount = Array.isArray(result.body?.warnings) ? result.body.warnings.length : 0;
        const signalCount = Array.isArray(result.body?.signals) ? result.body.signals.length : 0;
        console.log(`PASS ${testCase.name} | signals=${signalCount} warnings=${warningsCount}`);
      } else {
        failures.push({ name: testCase.name, reasons: result.reasons });
        summarizeFailure(testCase.name, result.reasons);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ name: testCase.name, reasons: [message] });
      summarizeFailure(testCase.name, [message]);
    }
  }

  console.log(`\nSummary: ${passCount}/${CASES.length} passed`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

await main();
