const socket = io();
window.socket = socket;

let currentUserId = null;
let currentRoom   = null;
let currentAdmin  = null;

socket.emit("debugLog", "script.js chargé");

// ── Paramètres URL ────────────────────────────────────────────────────────────
const params            = new URLSearchParams(window.location.search);
const roomFromURL       = params.get("room");
const userIdFromURL     = params.get("userId");
const useWebcamFromURL  = params.get("useWebcam") === "true";

socket.emit("debugLog", "params: " + params.toString());

// ── Compte admin (localStorage) ───────────────────────────────────────────────
function getStoredAdmin()       { const r = localStorage.getItem("adminUser"); return r ? JSON.parse(r) : null; }
function saveStoredAdmin(admin) { localStorage.setItem("adminUser", JSON.stringify(admin)); currentAdmin = admin; }
function clearStoredAdmin()     { localStorage.removeItem("adminUser"); currentAdmin = null; }

// ── Init pages admin ──────────────────────────────────────────────────────────
function initAdminPages() {
  currentAdmin = getStoredAdmin();
  const path   = window.location.pathname.split("/").pop();

  if (path === "dashboard.html") {
    if (!currentAdmin) { window.location.href = "identifprof.html"; return; }
    const adminSummary = document.getElementById("adminSummary");
    if (adminSummary) {
      adminSummary.innerHTML = `
        <p><strong>${currentAdmin.firstName || ""} ${currentAdmin.lastName || ""}</strong></p>
        <p>${currentAdmin.email}</p>
      `;
    }
    loadRoomHistory();
  }

  if ((path === "identifprof.html" || path === "PrincRegis.html") && currentAdmin) {
    window.location.href = "dashboard.html";
  }
}

initAdminPages();

// ── Fonctions admin ───────────────────────────────────────────────────────────

function createRoom() {
  if (!currentAdmin) { alert("Vous devez être connecté pour créer une salle."); return; }
  socket.emit("createRoom", { adminEmail: currentAdmin.email });
}

function registerAdmin() {
  const firstName = document.getElementById("prenom")?.value.trim();
  const lastName  = document.getElementById("nom")?.value.trim();
  const email     = document.getElementById("email")?.value.trim();
  const password  = document.getElementById("password")?.value;

  if (!firstName || !lastName || !email || !password) {
    alert("Tous les champs sont requis pour créer un compte.");
    return;
  }

  socket.emit("registerAdmin", { firstName, lastName, email, password }, (response) => {
    if (response.success) {
      saveStoredAdmin(response.user);
      window.location.href = "dashboard.html";
    } else {
      alert(response.message || "Impossible de créer le compte.");
    }
  });
}

function loginAdmin() {
  const email    = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;

  if (!email || !password) { alert("Email et mot de passe sont requis."); return; }

  socket.emit("loginAdmin", { email, password }, (response) => {
    if (response.success) {
      saveStoredAdmin(response.user);
      window.location.href = "dashboard.html";
    } else {
      alert(response.message || "Identifiants invalides.");
    }
  });
}

function logoutAdmin() {
  clearStoredAdmin();
  window.location.href = "identifprof.html";
}

function loadRoomHistory() {
  if (!currentAdmin) return;

  socket.emit("getRoomHistory", currentAdmin.email, (history) => {
    const roomList = document.getElementById("roomList");
    if (!roomList) return;

    if (history.length === 0) {
      roomList.innerHTML = '<p class="no-rooms">Aucune salle créée pour le moment.</p>';
      return;
    }

    roomList.innerHTML = history.map((room) => {
      const createdDate = new Date(room.createdAt);
      const dateStr     = createdDate.toLocaleDateString("fr-FR");
      const timeStr     = createdDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      return `
        <div class="room-item" onclick="viewHistoricalResults('${room.room}')">
          <div class="room-item-header">
            <div class="room-code">Salle ${room.room}</div>
            <div class="room-date">${dateStr} à ${timeStr}</div>
          </div>
          <div class="room-stats">
            <div class="room-stat">
              <span class="room-stat-icon">👥</span>
              <span>${room.participantCount} participant${room.participantCount > 1 ? "s" : ""}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");
  });
}

function viewHistoricalResults(roomCode) {
  if (!currentAdmin) return;

  socket.emit("getHistoricalResults", { adminEmail: currentAdmin.email, room: roomCode }, (results) => {
    if (results) {
      sessionStorage.setItem("historicalResults", JSON.stringify(results));
      window.location.href = `results.html?room=${roomCode}&historical=true`;
    } else {
      alert("Résultats non trouvés pour cette salle.");
    }
  });
}

// ── Événements admin (socket) ─────────────────────────────────────────────────

socket.on("roomCreated", (room) => {
  window.location.href = "RoomCreation.html?room=" + room;
});

// Sur RoomCreation.html
if (window.location.pathname.includes("RoomCreation.html") && roomFromURL) {
  currentRoom = roomFromURL;
  const el = document.getElementById("roomCode");
  if (el) el.innerText = currentRoom;
}

function sendQuestions() { socket.emit("sendQuestions", currentRoom); }

function viewResults() {
  if (!currentRoom) { alert("Aucune salle active"); return; }
  socket.emit("closeRoom", currentRoom);
  window.location.href = "results.html?room=" + currentRoom;
}

socket.on("results", (data) => { console.log("Résultats :", data); });

// ── Participant (socket) ──────────────────────────────────────────────────────

socket.on("joinedRoom", (data) => {
  socket.emit("debugLog", "joinedRoom reçu : room=" + data.room + " userId=" + data.userId);
  currentRoom   = data.room;
  currentUserId = data.userId;
  window.currentRoom   = currentRoom;
  window.currentUserId = currentUserId;

  const idDisplay = document.getElementById("userId");
  if (idDisplay) idDisplay.innerText = currentUserId;

  window.history.replaceState({}, "", `?room=${currentRoom}&userId=${currentUserId}`);
});

// ── Mise à jour des émotions en temps réel (DeepFace → serveur → ici) ────────
socket.on("emotionUpdate", (data) => {
  console.log("[emotionUpdate]", data);

  // Appeler la fonction d'affichage définie dans secondaire.html
  if (typeof window.updateEmotionDisplay === "function") {
    window.updateEmotionDisplay(data.emotions, data.age);
  }

  // Compatibilité ancienne : currentEmotion / ageDisplay inline
  const currentEmotion   = document.getElementById("currentEmotion");
  const ageDisplay       = document.getElementById("ageDisplay");
  const emotionIndicator = document.getElementById("emotionIndicator");

  if (data.emotions && Object.keys(data.emotions).length > 0) {
    const dominant = Object.keys(data.emotions).reduce(
      (a, b) => (data.emotions[a] > data.emotions[b] ? a : b)
    );

    const emotionTranslations = {
      happy:    "Heureux",
      sad:      "Triste",
      angry:    "En colère",
      fear:     "Peur",
      surprise: "Surpris",
      disgust:  "Dégoût",
      neutral:  "Neutre"
    };

    const label = emotionTranslations[dominant] || dominant;
    if (emotionIndicator) { emotionIndicator.textContent = `🟢 Émotion : ${label}`; emotionIndicator.style.color = "#2a7a2b"; }
    if (currentEmotion)   { currentEmotion.textContent   = `Émotion : ${label}`; }
  } else if (emotionIndicator) {
    emotionIndicator.textContent = "🔴 Détection en cours…";
    emotionIndicator.style.color = "#999";
  }

  if (data.age !== null && data.age !== undefined && ageDisplay && !ageDisplay.id.includes("ageDisplay")) {
    ageDisplay.textContent = `Âge estimé : ${Math.round(data.age)} ans`;
  }
});

// Salle invalide
socket.on("errorRoom", () => {
  alert("Salle inexistante");
  stopWebcam();
  window.location.href = "/";
});

// ── Page secondaire : rejoindre + webcam ──────────────────────────────────────
if (window.location.pathname.includes("secondaire.html") && roomFromURL) {

  socket.emit("debugLog", "Entrée dans secondaire.html");
  currentRoom = roomFromURL;

  const roomDisplay = document.getElementById("roomDisplay");
  if (roomDisplay) roomDisplay.innerText = currentRoom;

  if (userIdFromURL) {
    currentUserId = userIdFromURL;
    const idDisplay = document.getElementById("userId");
    if (idDisplay) idDisplay.innerText = currentUserId;

    socket.emit("joinRoom", { room: currentRoom, userId: currentUserId, useWebcam: useWebcamFromURL });
  } else {
    socket.emit("joinRoom", { room: currentRoom, useWebcam: useWebcamFromURL });
  }

  if (useWebcamFromURL) {
    // Afficher le panneau webcam (défini dans secondaire.html)
    if (typeof window.showWebcamPanel === "function") window.showWebcamPanel();
    startWebcam();
  } else {
    const videoBox = document.getElementById("videoBox");
    if (videoBox) videoBox.closest(".webcam-panel")?.remove();
  }
}

// ── Gestion webcam ────────────────────────────────────────────────────────────

let captureInterval = null;

function startWebcam() {
  const video   = document.getElementById("video");
  const statusDot = document.getElementById("statusDot");

  socket.emit("debugLog", "startWebcam appelé");

  if (!video) { socket.emit("debugLog", "Pas d'élément <video>"); return; }

  navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      socket.emit("debugLog", "Flux webcam obtenu");
      video.srcObject = stream;

      video.play()
        .then(() => {
          socket.emit("debugLog", "Vidéo en lecture, démarrage capture");
          startCapturingFrames(video);
          if (statusDot) statusDot.className = "status-dot active";
        })
        .catch((e) => console.error("Erreur lecture vidéo :", e));
    })
    .catch((e) => {
      console.error("Erreur webcam :", e);
      const indicator = document.getElementById("emotionIndicator");
      if (indicator) indicator.textContent = "❌ Webcam inaccessible";
      if (statusDot) statusDot.className = "status-dot error";
    });
}

function stopWebcam() {
  const video = document.getElementById("video");
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
  }
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  if (typeof window.stopFaceApiDetection === "function") {
    window.stopFaceApiDetection();
  }
}

function startCapturingFrames(video) {
  const canvas = document.createElement("canvas");
  const ctx    = canvas.getContext("2d");

  socket.emit("debugLog", "Démarrage boucle capture frames");

  captureInterval = setInterval(() => {
    if (video.paused || video.ended || video.readyState < 4) return;

    try {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const frameData = canvas.toDataURL("image/jpeg", 0.8);

      socket.emit("analyzeFrame", {
        frame:  frameData,
        room:   currentRoom,
        userId: currentUserId
      });
    } catch (e) {
      console.error("Erreur capture frame :", e);
    }
  }, 500); // 1 frame toutes les 500 ms
}

// ── Quiz ──────────────────────────────────────────────────────────────────────

const QUIZ_OPTIONS = [
  { value: "a", label: "Pas du tout" },
  { value: "b", label: "Peu d'accord" },
  { value: "c", label: "Neutre" },
  { value: "d", label: "D'accord" },
  { value: "e", label: "Tout à fait" }
];

socket.on("questions", (questions) => {
  const quizDiv = document.getElementById("quiz");
  if (!quizDiv) return;

  quizDiv.innerHTML = "";

  questions.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "quiz-question-card";
    card.innerHTML = `
      <div class="quiz-question-header">
        <span class="quiz-category-badge">${q.category}</span>
        <span class="quiz-question-number">${index + 1} / ${questions.length}</span>
      </div>
      <p class="quiz-question-text">${q.libelle}</p>
      <div class="quiz-options">
        ${QUIZ_OPTIONS.map(opt => `
          <label class="quiz-option-label">
            <input type="radio" name="q${index}" value="${opt.value}">
            <span>${opt.label}</span>
          </label>
        `).join("")}
      </div>
    `;
    quizDiv.appendChild(card);
  });

  const btn = document.createElement("button");
  btn.innerText = "Envoyer mes réponses";
  btn.className = "secondary-submit-btn";

  btn.onclick = () => {
    const answers     = [];
    let   allAnswered = true;

    questions.forEach((_, i) => {
      const selected = document.querySelector(`input[name="q${i}"]:checked`);
      if (!selected) allAnswered = false;
      answers.push(selected ? selected.value : null);
    });

    if (!allAnswered) { alert("Veuillez répondre à toutes les questions avant de valider."); return; }

    socket.emit("answers", { room: currentRoom, userId: currentUserId, answers });
    quizDiv.innerHTML = `
      <div class="quiz-success">
        <div class="quiz-success-icon">✅</div>
        <p>Réponses envoyées. Merci !</p>
      </div>
    `;
  };

  quizDiv.appendChild(btn);
});

// ── Fermeture de salle ────────────────────────────────────────────────────────

socket.on("roomClosed", () => {
  stopWebcam();
  window.location.href = "disconnected.html";
});
