const socket = io();
let currentUserId = null;
let currentRoom = null;
let currentAdmin = null;

socket.emit("debugLog", "script.js loaded");

// 🔍 récupérer code dans URL
const params = new URLSearchParams(window.location.search);
const roomFromURL = params.get("room");
const userIdFromURL = params.get("userId");
const useWebcamFromURL = params.get("useWebcam") === "true";

socket.emit("debugLog", "params: " + params.toString() + " roomFromURL: " + roomFromURL + " useWebcamFromURL: " + useWebcamFromURL);

function getStoredAdmin() {
  const raw = localStorage.getItem("adminUser");
  return raw ? JSON.parse(raw) : null;
}

function saveStoredAdmin(admin) {
  localStorage.setItem("adminUser", JSON.stringify(admin));
  currentAdmin = admin;
}

function clearStoredAdmin() {
  localStorage.removeItem("adminUser");
  currentAdmin = null;
}

function initAdminPages() {
  currentAdmin = getStoredAdmin();
  const path = window.location.pathname.split("/").pop();

  if (path === "dashboard.html") {
    if (!currentAdmin) {
      window.location.href = "identifprof.html";
      return;
    }
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

// ================= ACCUEIL =================

function createRoom() {
  if (!currentAdmin) {
    alert("Vous devez être connecté pour créer une salle.");
    return;
  }
  socket.emit("createRoom", { adminEmail: currentAdmin.email });
}

function joinRoom() {
  const room = document.getElementById("roomInput").value;
  window.location.href = "secondaire.html?room=" + room;
}

function registerAdmin() {
  const firstName = document.getElementById("prenom")?.value.trim();
  const lastName = document.getElementById("nom")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;
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
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;

  if (!email || !password) {
    alert("Email et mot de passe sont requis.");
    return;
  }

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

    roomList.innerHTML = history.map(room => {
      const createdDate = new Date(room.createdAt);
      const closedDate = new Date(room.closedAt);
      const dateStr = createdDate.toLocaleDateString('fr-FR');
      const timeStr = createdDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="room-item" onclick="viewHistoricalResults('${room.room}')">
          <div class="room-item-header">
            <div class="room-code">Salle ${room.room}</div>
            <div class="room-date">${dateStr} à ${timeStr}</div>
          </div>
          <div class="room-stats">
            <div class="room-stat">
              <span class="room-stat-icon">👥</span>
              <span>${room.participantCount} participant${room.participantCount > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  });
}

function viewHistoricalResults(roomCode) {
  if (!currentAdmin) return;

  socket.emit("getHistoricalResults", { adminEmail: currentAdmin.email, room: roomCode }, (results) => {
    if (results) {
      // Store results temporarily and redirect to results page
      sessionStorage.setItem('historicalResults', JSON.stringify(results));
      window.location.href = `results.html?room=${roomCode}&historical=true`;
    } else {
      alert("Résultats non trouvés pour cette salle.");
    }
  });
}

// ================= ADMIN =================

socket.on("roomCreated", (room) => {
  window.location.href = "RoomCreation.html?room=" + room;
});

// sur RoomCreation.html
if (window.location.pathname.includes("RoomCreation.html") && roomFromURL) {

  currentRoom = roomFromURL;
  
  document.getElementById("roomCode").innerText =
    currentRoom;
}

function sendQuestions() {
  socket.emit("sendQuestions", currentRoom);
}

function closeRoom() {
  window.location.href = "results.html?room=" + currentRoom;
  socket.emit("closeRoom", currentRoom);
}

function viewResults() {
  window.location.href = "results.html?room=" + currentRoom;
  socket.emit("closeRoom", currentRoom);
}

function getResults() {
  socket.emit("getResults", currentRoom);
}

socket.on("results", (data) => {
  console.log("Résultats :", data);
});

// ================= UTILISATEUR SECONDAIRE =================

socket.on("joinedRoom", (data) => {
  socket.emit("debugLog", "joinedRoom event received: room=" + data.room + " userId=" + data.userId);
  currentRoom = data.room;
  currentUserId = data.userId;

  // afficher ID
  const idDisplay = document.getElementById("userId");
  if (idDisplay) {
    idDisplay.innerText = currentUserId;
  }

  // ✅ mettre à jour l'URL sans reload
  const newURL = `?room=${currentRoom}&userId=${currentUserId}`;
  window.history.replaceState({}, "", newURL);
});

// Handle real-time emotion and age updates
socket.on("emotionUpdate", (data) => {
  console.log("emotionUpdate", data);
  const currentEmotion = document.getElementById("currentEmotion");
  const ageDisplay = document.getElementById("ageDisplay");
  const emotionIndicator = document.getElementById("emotionIndicator");

  if (data.emotions && Object.keys(data.emotions).length > 0) {
    const dominantEmotion = Object.keys(data.emotions).reduce((a, b) =>
      data.emotions[a] > data.emotions[b] ? a : b
    );

    const emotionTranslations = {
      'happy': 'Heureux',
      'sad': 'Triste',
      'angry': 'En colère',
      'fear': 'Peur',
      'surprise': 'Surpris',
      'disgust': 'Dégoût',
      'neutral': 'Neutre'
    };

    const displayedEmotion = emotionTranslations[dominantEmotion] || dominantEmotion;
    if (emotionIndicator) {
      emotionIndicator.textContent = `🟢 Émotion détectée : ${displayedEmotion}`;
      emotionIndicator.style.color = "#2a7a2b";
    }
    if (currentEmotion) {
      currentEmotion.textContent = `Émotion: ${displayedEmotion}`;
    }
  } else if (emotionIndicator) {
    emotionIndicator.textContent = "🔴 Détection d'émotions en cours";
    emotionIndicator.style.color = "#999";
  }

  if (data.age !== null && data.age !== undefined) {
    if (ageDisplay) {
      ageDisplay.textContent = `Âge estimé: ${Math.round(data.age)} ans`;
    }
  }
});

// 🔴 si room invalide
socket.on("errorRoom", () => {
  alert("Salle inexistante");
  stopWebcam();
  window.location.href = "/";
});

if (window.location.pathname.includes("secondaire.html") && roomFromURL) {

  socket.emit("debugLog", "Entering secondary.html block");
  currentRoom = roomFromURL;
  socket.emit("debugLog", "On secondaire.html, room: " + roomFromURL + " useWebcam: " + useWebcamFromURL);

  const roomDisplay = document.getElementById("roomDisplay");
  if (roomDisplay) {
    roomDisplay.innerText = currentRoom;
  }

  if (userIdFromURL) {
    currentUserId = userIdFromURL;

    const idDisplay = document.getElementById("userId");
    if (idDisplay) {
      idDisplay.innerText = currentUserId;
    }

    socket.emit("joinRoom", {
      room: currentRoom,
      userId: currentUserId,
      useWebcam: useWebcamFromURL
    });
  } else {
    socket.emit("joinRoom", {
      room: currentRoom,
      useWebcam: useWebcamFromURL
    });
  }

  if (useWebcamFromURL) {
    console.log("Starting webcam on secondaire.html");
    startWebcam();
  } else {
    const videoBox = document.getElementById("videoBox");
    if (videoBox) videoBox.classList.add("hidden");
  }
}

// WEBCAM FUNCTIONS
function startWebcam() {
  const video = document.getElementById("video");
  const videoBox = document.getElementById("videoBox");
  const emotionIndicator = document.getElementById("emotionIndicator");
  const currentEmotion = document.getElementById("currentEmotion");
  const ageDisplay = document.getElementById("ageDisplay");

  socket.emit("debugLog", "startWebcam called");

  if (!video) {
    socket.emit("debugLog", "No video element found");
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      socket.emit("debugLog", "Got webcam stream");
      video.srcObject = stream;
      video.play().then(() => {
        socket.emit("debugLog", "Video started playing");
        // Start capturing and sending frames to server
        startCapturingFrames(video);
      }).catch(e => {
        console.error("Video play failed:", e);
      });
      if (videoBox) videoBox.classList.remove("hidden");
      if (emotionIndicator) emotionIndicator.style.display = "block";
      if (currentEmotion) currentEmotion.textContent = "Analyse en cours...";
      if (ageDisplay) ageDisplay.textContent = "";
    })
    .catch(e => {
      console.error("Webcam error:", e);
      if (videoBox) videoBox.classList.add("hidden");
      if (emotionIndicator) emotionIndicator.style.display = "none";
    });
}

function stopWebcam() {
  const video = document.getElementById("video");
  const videoBox = document.getElementById("videoBox");
  const emotionIndicator = document.getElementById("emotionIndicator");
  
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  if (videoBox) videoBox.classList.add("hidden");
  if (emotionIndicator) emotionIndicator.style.display = "none";
}

let captureInterval = null;

function startCapturingFrames(video) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  
  socket.emit("debugLog", "Starting frame capture loop");
  
  captureInterval = setInterval(() => {
    if (video.paused || video.ended || video.readyState < 4) {
      return;
    }
    
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      
      // Convert to JPEG base64
      const frameData = canvas.toDataURL("image/jpeg", 0.8);
      
      // Send to server for analysis
      socket.emit("analyzeFrame", {
        frame: frameData,
        room: currentRoom,
        userId: currentUserId
      });
    } catch (e) {
      console.error("Frame capture error:", e);
    }
  }, 500); // Capture every 500ms
}

async function loadFaceApiModels() {
  // No longer needed - emotion detection happens on server
}

async function startFaceDetection() {
  // No longer needed - emotion detection happens on server
}

function stopFaceDetection() {
  if (faceDetectionInterval) {
    clearInterval(faceDetectionInterval);
    faceDetectionInterval = null;
  }
}

// ================= QUIZ =================

socket.on("questions", (questions) => {

  const quizDiv = document.getElementById("quiz");
  if (!quizDiv) return;

  quizDiv.innerHTML = "";

  questions.forEach((q, index) => {

    const div = document.createElement("div");

    div.innerHTML = `
      <p>${q.libelle}</p>
      <label><input type="radio" name="q${index}" value="a"> Pas du tout d'accord,</label>
      <label><input type="radio" name="q${index}" value="b"> Peu d'accord,</label>
      <label><input type="radio" name="q${index}" value="c"> Neutre,</label>
      <label><input type="radio" name="q${index}" value="d"> Plutôt d'accord,</label>
      <label><input type="radio" name="q${index}" value="e"> Tout à fait d'accord,</label>
    `;

    quizDiv.appendChild(div);
  });

  const btn = document.createElement("button");
  btn.innerText = "Envoyer mes réponses";
  btn.className = "secondary-submit-btn";

  btn.onclick = () => {

    const answers = [];
    let allAnswered = true;

    questions.forEach((_, i) => {
      const selected = document.querySelector(`input[name="q${i}"]:checked`);

      if (!selected) {
        allAnswered = false;
      }

      answers.push(selected ? selected.value : null);
    });

    if (!allAnswered) {
      alert("Veuillez répondre à toutes les questions avant de valider.");
      return;
    }

    socket.emit("answers", {
      room: currentRoom,
      userId: currentUserId,
      answers: answers
    });

    quizDiv.innerHTML = "<h3>Réponses envoyées</h3>";
  };
  quizDiv.appendChild(btn);
});

function viewResults() {
  console.log("CLICK VIEW RESULTS");

  if (!currentRoom) {
    alert("Aucune salle active");
    return;
  }

  socket.emit("closeRoom", currentRoom);
  window.location.href = "results.html?room=" + currentRoom;
}

// ================= FERMETURE =================

socket.on("roomClosed", () => {
  stopWebcam();
  window.location.href = "disconnected.html";
});