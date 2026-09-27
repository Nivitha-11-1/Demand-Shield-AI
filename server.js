require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_URL = (process.env.CREWAI_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.CREWAI_BEARER_TOKEN;
const PORT = Number(process.env.PORT || 3000);

if (!API_URL || !TOKEN) {
  console.warn("Missing CREWAI_API_URL or CREWAI_BEARER_TOKEN. Configure .env before using the app.");
}

const REQUIRED_FIELDS = [
  "product",
  "location",
  "current_orders",
  "historical_demand",
  "marketing_impact_pct"
];

function authHeaders() {
  return {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  };
}

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function toNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a valid number.`);
  }
  return n;
}

// Health check for your own website/backend.
app.get("/api/health", async (_req, res) => {
  if (!API_URL || !TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Backend is not configured. Add CREWAI_API_URL and CREWAI_BEARER_TOKEN."
    });
  }

  try {
    const r = await fetch(`${API_URL}/inputs`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }
    });
    const body = await r.text();
    res.status(r.ok ? 200 : 502).json({
      ok: r.ok,
      crewStatus: r.status,
      inputs: safeJson(body)
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Start a Demand Shield AI execution.
app.post("/api/analyze", async (req, res) => {
  try {
    if (!API_URL || !TOKEN) {
      return res.status(500).json({ error: "Server is not configured with CrewAI credentials." });
    }

    const body = req.body || {};
    for (const field of REQUIRED_FIELDS) {
      if (body[field] === undefined || body[field] === null || String(body[field]).trim() === "") {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    const inputs = {
      product: cleanText(body.product, 200),
      location: cleanText(body.location, 200),
      current_orders: toNumber(body.current_orders, "Current orders"),
      historical_demand: toNumber(body.historical_demand, "Historical demand"),
      marketing_impact_pct: toNumber(body.marketing_impact_pct, "Marketing impact %")
    };

    const response = await fetch(`${API_URL}/kickoff`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        inputs,
        meta: {
          source: "demand-shield-customer-web",
          requestId: crypto.randomUUID()
        }
      })
    });

    const text = await response.text();
    const data = safeJson(text);

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.detail || data?.error || text || "CrewAI kickoff failed."
      });
    }

    const kickoffId = data?.kickoff_id || data?.id;
    if (!kickoffId) {
      return res.status(502).json({
        error: "CrewAI started the request but did not return a kickoff_id.",
        raw: data
      });
    }

    res.json({ kickoff_id: kickoffId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
});

// Proxy execution status so the browser never sees the Bearer Token.
app.get("/api/status/:kickoffId", async (req, res) => {
  try {
    if (!API_URL || !TOKEN) {
      return res.status(500).json({ error: "Server is not configured with CrewAI credentials." });
    }

    const kickoffId = cleanText(req.params.kickoffId, 200);
    if (!kickoffId || !/^[A-Za-z0-9._:-]+$/.test(kickoffId)) {
      return res.status(400).json({ error: "Invalid kickoff ID." });
    }

    const response = await fetch(
      `${API_URL}/status/${encodeURIComponent(kickoffId)}`,
      { headers: { "Authorization": `Bearer ${TOKEN}` } }
    );

    const text = await response.text();
    const data = safeJson(text);

    res.status(response.ok ? 200 : response.status).json(data ?? { raw: text });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not reach CrewAI." });
  }
});

// Optional HITL endpoint for the Flow's "Request Human Approval" step.
// It uses the CrewAI /resume contract. The UI only calls this when an execution
// reports a paused/pending human review and supplies execution/task identifiers.
app.post("/api/resume", async (req, res) => {
  try {
    if (!API_URL || !TOKEN) {
      return res.status(500).json({ error: "Server is not configured with CrewAI credentials." });
    }

    const executionId = cleanText(req.body?.execution_id, 200);
    const taskId = cleanText(req.body?.task_id, 200);
    const humanFeedback = cleanText(req.body?.human_feedback, 2000);
    const isApprove = Boolean(req.body?.is_approve);

    if (!executionId || !taskId) {
      return res.status(400).json({ error: "execution_id and task_id are required for approval." });
    }

    const response = await fetch(`${API_URL}/resume`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        execution_id: executionId,
        task_id: taskId,
        human_feedback: humanFeedback || (isApprove ? "Approved." : "Rejected."),
        is_approve: isApprove
      })
    });

    const text = await response.text();
    const data = safeJson(text);
    res.status(response.ok ? 200 : response.status).json(data ?? { raw: text });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not resume CrewAI execution." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Demand Shield AI web app listening on port ${PORT}`);
});

function safeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}
