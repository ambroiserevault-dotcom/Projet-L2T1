const socket = io();
const params = new URLSearchParams(window.location.search);
const room   = params.get("room") || "";

// ── UI refs ───────────────────────────────────────────────────────────────────
const elCode       = document.getElementById("codeAffiche");
const elNomSalle   = document.getElementById("nomSalleHeader");
const elNb         = document.getElementById("nbParticipants");
const elListe      = document.getElementById("listeParticipants");
const elEmpty      = document.getElementById("emptyState");
const elDot        = document.getElementById("dotLive");
const elStatus     = document.getElementById("liveStatusText");
const elKpiP       = document.getElementById("kpiParticipants");
const elKpiQ       = document.getElementById("kpiQuestionnaires");
const elKpiW       = document.getElementById("kpiWebcam");
const elKpiNW      = document.getElementById("kpiNoWebcam");
const elBar        = document.getElementById("progressBar");
const elBarLabel   = document.getElementById("progressLabel");
const elHint       = document.getElementById("hintLancer");
const elEmoRows    = document.getElementById("emotionRows");
const elEmoList    = document.getElementById("participantsEmotionsList");
const elDashboard  = document.getElementById("emotionDashboard");

elCode.textContent     = room;
elNomSalle.textContent = `Salle ${room}`;

// ── Émotion méta ─────────────────────────────────────────────────────────────
const EMOTION_META = {
  happy:     { label: "😊 Heureux",  color: "#f59e0b" },
  neutral:   { label: "😐 Neutre",   color: "#6b7280" },
  sad:       { label: "😢 Triste",   color: "#3b82f6" },
  angry:     { label: "😠 Colère",   color: "#ef4444" },
  surprised: { label: "😲 Surpris",  color: "#f97316" },
  fearful:   { label: "😨 Peur",     color: "#8b5cf6" },
  disgusted: { label: "🤢 Dégoûté", color: "#22c55e" }
};
const EMOTION_ORDER = ["happy", "neutral", "sad", "angry", "surprised", "fearful", "disgusted"];

// ── Chart.js ──────────────────────────────────────────────────────────────────
let pieChart  = null;
let lineChart = null;

function initCharts() {
  const pieCtx  = document.getElementById("emotionPieChart")?.getContext("2d");
  const lineCtx = document.getElementById("emotionLineChart")?.getContext("2d");
  if (!pieCtx || !lineCtx) return;

  pieChart = new Chart(pieCtx, {
    type: "doughnut",
    data: {
      labels: EMOTION_ORDER.map(k => EMOTION_META[k].label),
      datasets: [{
        data: EMOTION_ORDER.map(() => 0),
        backgroundColor: EMOTION_ORDER.map(k => EMOTION_META[k].color),
        borderColor: "#fff",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { font: { size: 12 }, padding: 12 } } }
    }
  });

  lineChart = new Chart(lineCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: EMOTION_ORDER.map(k => ({
        label: EMOTION_META[k].label,
        data: [],
        borderColor: EMOTION_META[k].color,
        backgroundColor: EMOTION_META[k].color + "22",
        tension: 0.3,
        pointRadius: 3
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + "%" } } },
      plugins: { legend: { position: "bottom", labels: { font: { size: 11 }, padding: 10 } } }
    }
  });
}

function updateCharts(overallEmotions) {
  if (!pieChart || !lineChart) return;

  const total = EMOTION_ORDER.reduce((s, k) => s + (overallEmotions[k] || 0), 0);
  if (!total) return;

  const pcts = EMOTION_ORDER.map(k => Math.round(((overallEmotions[k] || 0) / total) * 100));

  // Pie
  pieChart.data.datasets[0].data = pcts;
  pieChart.update();

  // Line — append a new time point (max 20)
  const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (lineChart.data.labels.length >= 20) {
    lineChart.data.labels.shift();
    lineChart.data.datasets.forEach(d => d.data.shift());
  }
  lineChart.data.labels.push(now);
  lineChart.data.datasets.forEach((d, i) => d.data.push(pcts[i]));
  lineChart.update();
}

// ── Render emotion text-bars ──────────────────────────────────────────────────
function renderEmotionRows(overallEmotions) {
  elEmoRows.innerHTML = "";
  const total = EMOTION_ORDER.reduce((s, k) => s + (overallEmotions[k] || 0), 0);

  if (!total) {
    elEmoRows.innerHTML = "<span style='font-size:13px;color:#aaa;font-style:italic'>Aucune donnée d'émotion encore.</span>";
    return;
  }

  EMOTION_ORDER.forEach(key => {
    const count = overallEmotions[key] || 0;
    const pct   = Math.round((count / total) * 100);
    const meta  = EMOTION_META[key];

    const row = document.createElement("div");
    row.className = "emotion-row";
    row.innerHTML = `
      <span class="emotion-label">${meta.label}</span>
      <div class="emotion-track">
        <div class="emotion-fill" style="width:${pct}%;background:${meta.color}"></div>
      </div>
      <span class="emotion-value">${pct}%</span>
    `;
    elEmoRows.appendChild(row);
  });
}

// ── Render per-participant emotion list ───────────────────────────────────────
function renderParticipantEmotions(players) {
  elEmoList.innerHTML = "";

  players.forEach(p => {
    const meta    = EMOTION_META[p.dominantEmotion] || { label: p.dominantEmotion || "—" };
    const initials = (
      ((p.profile.firstName || "")[0] || "") +
      ((p.profile.lastName  || "")[0] || "")
    ).toUpperCase() || "?";
    const name    = [p.profile.firstName, p.profile.lastName].filter(Boolean).join(" ") || p.userId;

    const item = document.createElement("div");
    item.className = "participant-emotion-item";
    item.innerHTML = `
      <div class="participant-emotion-info">
        <div class="participant-emotion-avatar">${initials}</div>
        <div class="participant-emotion-details">
          <h4>${name}</h4>
          <p>${p.sessionCount > 0 ? `${p.sessionCount} session(s)` : "Pas encore de questionnaire"}</p>
        </div>
      </div>
      <div class="participant-emotion-badge">${meta.label}</div>
    `;
    elEmoList.appendChild(item);
  });
}

// ── Render participant list ───────────────────────────────────────────────────
function renderPlayers(players) {
  elListe.innerHTML = "";

  if (!players.length) {
    elListe.appendChild(elEmpty);
    elEmpty.style.display = "block";
    elDot.classList.remove("active");
    elStatus.textContent = "En attente";
    return;
  }

  elEmpty.style.display = "none";
  elDot.classList.add("active");
  elStatus.textContent = `${players.length} participant(s) connecté(s)`;

  players.forEach(p => {
    const initials = (
      ((p.profile.firstName || "")[0] || "") +
      ((p.profile.lastName  || "")[0] || "")
    ).toUpperCase() || "?";
    const name = [p.profile.firstName, p.profile.lastName].filter(Boolean).join(" ") || "Anonyme";
    const sub  = p.profile.email || p.userId;
    const mode = p.useWebcam ? "webcam" : "questionnaire";

    const row = document.createElement("div");
    row.className = "participant-row";
    row.innerHTML = `
      <div class="participant-info">
        <div class="avatar">${initials}</div>
        <div>
          <div class="participant-nom">${name}</div>
          <div class="participant-sub">${sub}</div>
        </div>
      </div>
      <div class="participant-badges">
        <span class="badge ${mode === "webcam" ? "badge-webcam" : "badge-question"}">
          ${mode === "webcam" ? "Webcam" : "Questionnaire"}
        </span>
        <span class="badge badge-connecte">Connecté</span>
      </div>
    `;
    elListe.appendChild(row);
  });
}

// ── Main render ───────────────────────────────────────────────────────────────
function render(snapshot) {
  const players   = snapshot.players || [];
  const emotions  = snapshot.overallEmotions || {};
  const total     = snapshot.totalParticipants || 0;
  const answered  = snapshot.totalAnswered || 0;
  const webcam    = players.filter(p => p.useWebcam).length;

  renderPlayers(players);

  // KPIs
  elKpiP.textContent   = total;
  elKpiQ.textContent   = answered;
  elKpiW.textContent   = webcam;
  elKpiNW.textContent  = players.length - webcam;
  elNb.textContent     = players.length;

  // Progress
  const pct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
  elBar.style.width    = pct + "%";
  elBarLabel.textContent = pct + "%";

  // Emotions dashboard (show once there's data)
  const hasEmotions = Object.values(emotions).some(v => v > 0);
  if (hasEmotions || players.length > 0) {
    elDashboard.classList.remove("hidden");
  }

  renderEmotionRows(emotions);
  renderParticipantEmotions(players);
  updateCharts(emotions);

  // Update last-update time
  const liveTime = document.getElementById("liveUpdateTime");
  if (liveTime) liveTime.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.emit("watchRoom", { room });

socket.on("roomUpdate", (snapshot) => {
  if (snapshot) render(snapshot);
});

socket.on("errorRoom", () => {
  alert("Salle introuvable ou expirée.");
  window.location.href = "dashboard.html";
});

// ── Actions ───────────────────────────────────────────────────────────────────
window.sendQuestions = function () {
  socket.emit("sendQuestions", room);
  elHint.textContent = "Questions envoyées aux participants ✓";
  setTimeout(() => { elHint.textContent = ""; }, 3000);
};

window.viewResults = function () {
  socket.emit("closeRoom", room);
  window.location.href = "results.html?room=" + room;
};

window.copierCode = function () {
  navigator.clipboard.writeText(room)
    .then(() => { elHint.textContent = `Code ${room} copié dans le presse-papiers ✓`; })
    .catch(() => { elHint.textContent = room; });
  setTimeout(() => { elHint.textContent = ""; }, 3000);
};

// ── Init charts after DOM is ready ────────────────────────────────────────────
window.addEventListener("load", () => {
  setTimeout(initCharts, 100);
});
