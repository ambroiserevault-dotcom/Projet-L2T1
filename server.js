const fs = require("fs");
const rawData = fs.readFileSync("./questions.json");
const questionsData = JSON.parse(rawData);
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const { spawn } = require("child_process");
let userCounter = 0;

const io = new Server(server);

app.use(express.static("public"));

const rooms = {};           // stockage des salles
const adminAccounts = {};
const roomHistory = {};     // stockage permanent des résultats des salles
const pythonProcesses = {}; // Map de socketId -> pythonProcess

// ─────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────

// Snapshot léger d'une salle pour le tableau de bord admin (salle.html)
function buildRoomSnapshot(roomCode) {
  const r = rooms[roomCode];
  if (!r) return null;

  const players = r.players.map((p) => {
    const ans = r.answers[p.userId] || {};
    return {
      userId:         p.userId,
      profile:        ans.profile        || {},
      useWebcam:      p.useWebcam        || false,
      emotionStats:   ans.emotions       || {},
      dominantEmotion: ans.dominantEmotion || "neutral",
      sessionCount:   (ans.sessions || []).length
    };
  });

  // Agrégat des émotions de tous les participants
  const overallEmotions = {};
  for (const uid in r.answers) {
    for (const [e, c] of Object.entries(r.answers[uid].emotions || {})) {
      overallEmotions[e] = (overallEmotions[e] || 0) + Number(c || 0);
    }
  }

  const totalAnswered = Object.values(r.answers)
    .filter((u) => u.sessions && u.sessions.length > 0).length;

  return {
    room:             roomCode,
    players,
    overallEmotions,
    totalParticipants: Object.keys(r.answers).length,
    totalAnswered,
    createdAt:        r.createdAt,
    adminEmail:       r.adminEmail
  };
}

function generateUserId(room) {
  const id = "I" + String(rooms[room].userCounter).padStart(4, "0");
  rooms[room].userCounter++;
  return id;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getRandomQuestions(nb = 5) {
  const allQuestions = Object.values(questionsData.questionnaire.questions);
  const shuffled = allQuestions.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, nb);
}

// ─────────────────────────────────────────
// Démarrage d'un processus Python DeepFace
// pour un utilisateur donné
// ─────────────────────────────────────────

function startFaceRecognition(socket, room, userId) {
  console.log(`[DEEPFACE] Démarrage pour user=${userId} room=${room}`);

  const pythonProcess = spawn("python", ["face_recognition.py"], {
    cwd: __dirname,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdoutBuffer = "";

  pythonProcess.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop(); // garde la ligne incomplète pour plus tard

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const output = JSON.parse(trimmed);
        console.log(`[DEEPFACE OUTPUT] user=${userId}`, output);

        if (output.emotions || output.average_age !== null) {
          // Stocker dans la salle
          if (rooms[room] && rooms[room].answers[userId]) {
            rooms[room].answers[userId].emotions = output.emotions || {};
            rooms[room].answers[userId].ageData  = output.average_age;

            // Déterminer l'émotion dominante
            const emotions = output.emotions || {};
            const dominant = Object.keys(emotions).reduce(
              (a, b) => (emotions[a] > emotions[b] ? a : b),
              "neutral"
            );
            rooms[room].answers[userId].dominantEmotion = dominant;
          }

          // Envoyer la mise à jour en temps réel au client
          socket.emit("emotionUpdate", {
            emotions: output.emotions || {},
            age: output.average_age
          });
        }
      } catch (e) {
        // ligne non-JSON ignorée (logs Python, avertissements TF, etc.)
        console.log(`[DEEPFACE] Ligne non-JSON ignorée : "${trimmed}"`);
      }
    });
  });

  pythonProcess.stderr.on("data", (chunk) => {
    // Les warnings TensorFlow arrivent sur stderr — on les affiche
    // seulement si c'est une vraie erreur (pas de stack trace tf)
    const msg = chunk.toString();
    if (!msg.includes("I tensorflow") && !msg.includes("W tensorflow")) {
      console.error(`[DEEPFACE STDERR] user=${userId} :`, msg.trim());
    }
  });

  pythonProcess.on("close", (code) => {
    console.log(`[DEEPFACE] Processus fermé pour user=${userId} (code=${code})`);
    delete pythonProcesses[socket.id];
  });

  return pythonProcess;
}

// ─────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────

io.on("connection", (socket) => {

  // ── Créer une salle ──────────────────────
  socket.on("createRoom", (data) => {
    const adminEmail = data?.adminEmail;
    if (!adminEmail) {
      socket.emit("error", "Professeur non identifié");
      return;
    }

    const room      = generateRoomCode();
    const createdAt = new Date();

    rooms[room] = {
      players: [],
      userCounter: 0,
      answers: {},
      currentQuestions: [],
      closed: false,
      adminEmail,
      createdAt,
      emotionTimeline: [],
      questionnaireTimeline: []
    };

    socket.join(room);
    socket.emit("roomCreated", room);
    console.log("Salle créée :", room, "par", adminEmail);
  });

  // ── Inscription professeur ───────────────
  socket.on("registerAdmin", (data, callback) => {
    const email     = (data.email     || "").trim().toLowerCase();
    const password  = data.password   || "";
    const firstName = (data.firstName || "").trim();
    const lastName  = (data.lastName  || "").trim();

    if (!email || !password || !firstName || !lastName) {
      callback({ success: false, message: "Tous les champs sont requis." });
      return;
    }

    if (adminAccounts[email]) {
      callback({ success: false, message: "Un compte existe déjà pour cet email." });
      return;
    }

    adminAccounts[email] = { email, password, firstName, lastName };
    callback({ success: true, user: { email, firstName, lastName } });
  });

  // ── Connexion professeur ─────────────────
  socket.on("loginAdmin", (data, callback) => {
    const email    = (data.email || "").trim().toLowerCase();
    const password = data.password || "";

    const account = adminAccounts[email];
    if (!account || account.password !== password) {
      callback({ success: false, message: "Email ou mot de passe incorrect." });
      return;
    }

    callback({ success: true, user: { email: account.email, firstName: account.firstName, lastName: account.lastName } });
  });

  // ── Surveiller une salle (admin → salle.html) ───────────────────
  socket.on("watchRoom", ({ room }) => {
    if (!rooms[room]) { socket.emit("errorRoom"); return; }
    socket.join(room);
    socket.emit("roomUpdate", buildRoomSnapshot(room));
  });

  // ── Rejoindre une salle ──────────────────
  socket.on("joinRoom", (data) => {
    const room = data.room;

    if (!rooms[room]) {
      socket.emit("errorRoom");
      return;
    }

    // Réutiliser l'userId si déjà attribué (refresh)
    const userId = data.userId || generateUserId(room);

    const profile   = {};
    const firstName = typeof data.firstName === "string" ? data.firstName.trim() : "";
    const lastName  = typeof data.lastName  === "string" ? data.lastName.trim()  : "";
    const email     = typeof data.email     === "string" ? data.email.trim()     : "";

    if (firstName) profile.firstName = firstName;
    if (lastName)  profile.lastName  = lastName;
    if (email)     profile.email     = email;

    socket.join(room);

    const player = {
      socketId:  socket.id,
      userId,
      profile,
      useWebcam: data.useWebcam || false
    };

    // Initialiser les données de l'utilisateur si nécessaire
    if (!rooms[room].answers[userId] || typeof rooms[room].answers[userId] !== "object") {
      rooms[room].answers[userId] = {
        sessions: [],
        profile:  {},
        emotions: {},
        ageData:  null,
        dominantEmotion: "neutral"
      };
    }

    if (Object.keys(profile).length > 0) {
      rooms[room].answers[userId].profile = {
        ...rooms[room].answers[userId].profile,
        ...profile
      };
    }

    rooms[room].players.push(player);

    // ── Démarrer DeepFace si webcam activée ──
    if (data.useWebcam) {
      const pythonProcess = startFaceRecognition(socket, room, userId);
      player.pythonProcess        = pythonProcess;
      pythonProcesses[socket.id]  = pythonProcess;
    }

    socket.emit("joinedRoom", { room, userId });

    if (rooms[room].closed) {
      socket.emit("roomClosed", { room, results: rooms[room].finalResults });
    }

    // Notifier le tableau de bord admin
    io.to(room).emit("roomUpdate", buildRoomSnapshot(room));
  });

  // ── Envoyer les questions (admin) ────────
  socket.on("sendQuestions", (room) => {
    if (!rooms[room]) return;
    const questions = getRandomQuestions(5);
    rooms[room].currentQuestions = questions;
    io.to(room).emit("questions", questions);
  });

  // ── Réponses des participants ────────────
  socket.on("answers", (data) => {
    const { room, userId, answers } = data;
    if (!rooms[room]) return;

    if (answers.includes(null)) {
      console.log("Réponses incomplètes refusées");
      return;
    }

    if (!rooms[room].answers[userId]) {
      rooms[room].answers[userId] = { sessions: [] };
    }

    rooms[room].answers[userId].sessions.push({
      answers:   [...answers],
      questions: [...rooms[room].currentQuestions]
    });

    console.log("Room:", room, "| User:", userId, "| Réponses stockées");

    // Snapshot room-wide questionnaire scores after each answer batch
    rooms[room].questionnaireTimeline = rooms[room].questionnaireTimeline || [];
    rooms[room].questionnaireTimeline.push({ t: Date.now(), scores: computeRoomOverview(room) });

    io.to(room).emit("roomUpdate", buildRoomSnapshot(room));
  });

  // ── Rapport d'émotions cumulées (face-api côté client) ──────────
  socket.on("reportEmotions", (data) => {
    const { room, userId, emotionStats, dominantEmotion } = data;
    if (!rooms[room] || !rooms[room].answers[userId]) return;

    rooms[room].answers[userId].emotions        = emotionStats    || {};
    rooms[room].answers[userId].dominantEmotion = dominantEmotion || "neutral";

    // Snapshot room-wide emotion percentages at most every 15 seconds
    const tl = rooms[room].emotionTimeline;
    const now = Date.now();
    if (tl.length === 0 || now - tl[tl.length - 1].t >= 15000) {
      const roomEmotions = {};
      for (const uid in rooms[room].answers) {
        for (const [e, c] of Object.entries(rooms[room].answers[uid].emotions || {})) {
          roomEmotions[e] = (roomEmotions[e] || 0) + Number(c || 0);
        }
      }
      const eTotal = Object.values(roomEmotions).reduce((a, b) => a + b, 0) || 1;
      const pct = {};
      for (const [e, c] of Object.entries(roomEmotions)) pct[e] = Math.round((c / eTotal) * 1000) / 10;
      tl.push({ t: now, emotions: pct });
    }

    io.to(room).emit("roomUpdate", buildRoomSnapshot(room));
  });

  // ── Recevoir un frame webcam ─────────────
  // Le frame est transmis au processus Python DeepFace via stdin
  let frameCount = 0;
  socket.on("analyzeFrame", (data) => {
    frameCount++;

    if (frameCount % 10 === 0) {
      console.log(`[analyzeFrame #${frameCount}] socket=${socket.id}`);
    }

    const pythonProcess = pythonProcesses[socket.id];
    if (!pythonProcess) {
      if (frameCount === 1) {
        console.warn("[analyzeFrame] Aucun processus Python trouvé pour socket:", socket.id);
      }
      return;
    }

    try {
      const frameData = JSON.stringify({ frame: data.frame });
      const written   = pythonProcess.stdin.write(frameData + "\n");

      if (!written && frameCount % 10 === 0) {
        console.warn("[analyzeFrame] Buffer plein, Python trop lent");
      }
    } catch (e) {
      console.error("[analyzeFrame] Erreur écriture stdin:", e);
    }
  });

  // ── Calculs de scores ────────────────────

  function convertAnswer(ans) {
    return ({ a: -2, b: -1, c: 0, d: 1, e: 2 }[ans]) ?? 0;
  }

  function getCategoryList() {
    return (
      questionsData.questionnaire.metadata.categories ||
      Object.values(questionsData.questionnaire.questions)
        .map((q) => q.category)
        .filter((v, i, a) => a.indexOf(v) === i)
    );
  }

  function computeScores(room, userId) {
    const userData = rooms[room].answers[userId];
    if (!userData) return null;

    const totals = {};
    const counts = {};
    const categories = getCategoryList();
    categories.forEach((cat) => { totals[cat] = 0; counts[cat] = 0; });

    (userData.sessions || []).forEach((session) => {
      if (!session || !Array.isArray(session.answers)) return;
      session.answers.forEach((ans, i) => {
        if (!ans) return;
        const question = session.questions[i];
        if (!question) return;
        let value = convertAnswer(ans);
        if (question.reversed) value = -value;
        totals[question.category] += value;
        counts[question.category]++;
      });
    });

    const scores = {};
    categories.forEach((cat) => {
      scores[cat] = counts[cat] > 0 ? Number((totals[cat] / counts[cat]).toFixed(2)) : null;
    });
    return scores;
  }

  function computeRoomOverview(room) {
    const totals = {};
    const counts = {};
    const categories = getCategoryList();
    categories.forEach((cat) => { totals[cat] = 0; counts[cat] = 0; });

    for (const userId in rooms[room].answers) {
      const userData = rooms[room].answers[userId];
      (userData.sessions || []).forEach((session) => {
        if (!session || !Array.isArray(session.answers)) return;
        session.answers.forEach((ans, i) => {
          if (!ans) return;
          const question = session.questions[i];
          if (!question) return;
          let value = convertAnswer(ans);
          if (question.reversed) value = -value;
          totals[question.category] += value;
          counts[question.category]++;
        });
      });
    }

    const overview = {};
    categories.forEach((cat) => {
      overview[cat] = counts[cat] > 0 ? Number((totals[cat] / counts[cat]).toFixed(2)) : null;
    });
    return overview;
  }

  function buildResultsPayload(room) {
    const users          = {};
    const overallEmotions = {};

    for (const userId in rooms[room].answers) {
      const userData = rooms[room].answers[userId];
      const emotions = userData.emotions || {};

      users[userId] = {
        scores:          computeScores(room, userId),
        profile:         userData.profile         || {},
        emotions,
        dominantEmotion: userData.dominantEmotion  || "neutral",
        age:             userData.ageData
      };

      // Agréger les compteurs d'émotions de tous les participants
      for (const [emotion, count] of Object.entries(emotions)) {
        overallEmotions[emotion] = (overallEmotions[emotion] || 0) + Number(count || 0);
      }
    }

    return {
      room,
      categories:            getCategoryList(),
      users,
      overall:               computeRoomOverview(room),
      overallEmotions,
      emotionTimeline:       rooms[room].emotionTimeline       || [],
      questionnaireTimeline: rooms[room].questionnaireTimeline || []
    };
  }

  // ── Fermer la salle ──────────────────────
  socket.on("closeRoom", (room) => {
    if (!rooms[room]) return;

    const payload          = buildResultsPayload(room);
    const participantCount = Object.keys(rooms[room].answers).length;

    if (!roomHistory[rooms[room].adminEmail]) {
      roomHistory[rooms[room].adminEmail] = [];
    }
    roomHistory[rooms[room].adminEmail].push({
      room,
      createdAt: rooms[room].createdAt,
      closedAt:  new Date(),
      participantCount,
      results:   payload
    });

    rooms[room].closed       = true;
    rooms[room].finalResults = payload;

    io.to(room).emit("roomClosed", { room, results: payload });
    console.log("Salle mise en mode résultats :", room);
  });

  socket.on("deleteRoom", (room) => {
    if (!rooms[room]) return;
    delete rooms[room];
    console.log("Salle supprimée définitivement :", room);
  });

  socket.on("getResults", (room) => {
    if (!rooms[room]) return;
    const payload = rooms[room].finalResults || buildResultsPayload(room);
    socket.emit("results", payload);
  });

  socket.on("getRoomHistory", (adminEmail, callback) => {
    const history = (roomHistory[adminEmail] || []).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    callback(history);
  });

  socket.on("getHistoricalResults", (data, callback) => {
    const { adminEmail, room } = data;
    const history = roomHistory[adminEmail] || [];
    const roomData = history.find((h) => h.room === room);
    callback(roomData ? roomData.results : null);
  });

  // ── Déconnexion ──────────────────────────
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      const room        = rooms[roomCode];
      const playerIndex = room.players.findIndex((p) => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        if (player.pythonProcess) {
          player.pythonProcess.kill();
          console.log(`[DEEPFACE] Processus tué pour user=${player.userId}`);
          delete pythonProcesses[socket.id];
        }
        room.players.splice(playerIndex, 1);
        io.to(roomCode).emit("roomUpdate", buildRoomSnapshot(roomCode));
        break;
      }
    }
  });

  // ── Debug client ─────────────────────────
  socket.on("debugLog", (message) => {
    console.log("CLIENT DEBUG:", message);
  });

});

server.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});
