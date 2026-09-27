const form = document.getElementById("analysisForm");
const button = document.getElementById("analyzeButton");
const buttonText = document.getElementById("buttonText");
const spinner = document.getElementById("spinner");
const message = document.getElementById("message");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const result = document.getElementById("result");
const resultText = document.getElementById("resultText");
const approval = document.getElementById("approval");
const approvalNote = document.getElementById("approvalNote");
const approveButton = document.getElementById("approveButton");
const rejectButton = document.getElementById("rejectButton");
const copyResult = document.getElementById("copyResult");

let activeExecutionId = null;
let activeTaskId = null;
let pollTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetView();
  setBusy(true);

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  payload.current_orders = Number(payload.current_orders);
  payload.historical_demand = Number(payload.historical_demand);
  payload.marketing_impact_pct = Number(payload.marketing_impact_pct);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start analysis.");

    activeExecutionId = data.kickoff_id;
    showProgress("Demand Shield AI is analyzing your request…");
    await pollStatus();
  } catch (err) {
    showError(err.message);
    setBusy(false);
  }
});

async function pollStatus() {
  clearTimeout(pollTimer);
  if (!activeExecutionId) return;

  try {
    const response = await fetch(`/api/status/${encodeURIComponent(activeExecutionId)}`);
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Could not read execution status.");

    const state = String(data.status || data.state || "").toLowerCase();
    const task = data.current_task || data.task || data.currentTask || "";
    activeTaskId = data.task_id || data.current_task_id || data.taskId || activeTaskId;

    if (state === "completed" || state === "success" || state === "succeeded") {
      showFinal(data.result ?? data.output ?? data);
      setBusy(false);
      return;
    }

    if (state === "error" || state === "failed" || state === "failure") {
      showError(data.error || data.message || "Demand Shield AI execution failed.");
      setBusy(false);
      return;
    }

    if (isHumanReviewState(data)) {
      showApproval(task || "Human approval");
      setBusy(false);
      return;
    }

    const pct = Number(data.progress?.percent ?? data.progress?.percentage ?? 0);
    progressBar.style.width = `${Math.min(95, Math.max(15, pct))}%`;
    progressText.textContent = task ? `Working on: ${task}` : "Demand Shield AI is processing…";

    pollTimer = setTimeout(pollStatus, 2000);
  } catch (err) {
    showError(err.message);
    setBusy(false);
  }
}

function isHumanReviewState(data) {
  const state = String(data.status || data.state || "").toLowerCase();
  return ["paused", "pending", "waiting", "human_input", "awaiting_human_input"].includes(state)
    || Boolean(data.waiting_for_human || data.human_input_required);
}

async function resume(approved) {
  if (!activeExecutionId || !activeTaskId) {
    showError("The deployment did not expose the execution/task ID needed for approval. Check the CrewAI execution details.");
    return;
  }

  approveButton.disabled = true;
  rejectButton.disabled = true;

  try {
    const response = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        execution_id: activeExecutionId,
        task_id: activeTaskId,
        human_feedback: approvalNote.value.trim(),
        is_approve: approved
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not resume the flow.");

    approval.classList.add("hidden");
    showProgress(approved ? "Approved. Demand Shield AI is continuing…" : "Rejection recorded. Finalizing…");
    setBusy(true);
    await pollStatus();
  } catch (err) {
    showError(err.message);
    approveButton.disabled = false;
    rejectButton.disabled = false;
  }
}

approveButton.addEventListener("click", () => resume(true));
rejectButton.addEventListener("click", () => resume(false));

copyResult.addEventListener("click", async () => {
  await navigator.clipboard.writeText(resultText.textContent);
  copyResult.textContent = "Copied";
  setTimeout(() => copyResult.textContent = "Copy", 1200);
});

function showFinal(value) {
  progress.classList.add("hidden");
  approval.classList.add("hidden");
  result.classList.remove("hidden");
  resultText.textContent = formatResult(value);
  message.classList.add("hidden");
}

function formatResult(value) {
  if (typeof value === "string") return value;
  if (value?.output && typeof value.output === "string") return value.output;
  if (value?.result?.output && typeof value.result.output === "string") return value.result.output;
  return JSON.stringify(value, null, 2);
}

function showProgress(text) {
  message.classList.add("hidden");
  result.classList.add("hidden");
  approval.classList.add("hidden");
  progress.classList.remove("hidden");
  progressText.textContent = text;
}

function showApproval(task) {
  progress.classList.add("hidden");
  approval.classList.remove("hidden");
  approval.querySelector("p").textContent = `The flow is waiting for a human decision at: ${task}.`;
}

function showError(text) {
  progress.classList.add("hidden");
  approval.classList.add("hidden");
  message.textContent = text;
  message.classList.remove("hidden");
}

function resetView() {
  clearTimeout(pollTimer);
  activeExecutionId = null;
  activeTaskId = null;
  message.classList.add("hidden");
  progress.classList.add("hidden");
  approval.classList.add("hidden");
  result.classList.add("hidden");
  progressBar.style.width = "15%";
  approveButton.disabled = false;
  rejectButton.disabled = false;
}

function setBusy(busy) {
  button.disabled = busy;
  spinner.classList.toggle("hidden", !busy);
  buttonText.textContent = busy ? "Analyzing…" : "Analyze Demand";
}
