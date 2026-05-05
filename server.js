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

const rooms = {}; // stockage des salles
const adminAccounts = {};
const roomHistory = {}; // stockage permanent des résultats des salles
const pythonProcesses = {}; // Map of socketId -> pythonProcess

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

  // mélanger tableau
  const shuffled = allQuestions.sort(() => 0.5 - Math.random());

  // prendre nb questions
  return shuffled.slice(0, nb);
}

io.on("connection", (socket) => {

  // 🔹 créer une room
  socket.on("createRoom", (data) => {
    const adminEmail = data?.adminEmail;
    if (!adminEmail) {
      socket.emit("error", "Professeur non identifié");
      return;
    }

    const room = generateRoomCode();
    const createdAt = new Date();

    rooms[room] = {
      players: [],
      userCounter: 0,
      answers: {},
      currentQuestions: [],
      closed: false,
      adminEmail,
      createdAt
    };

    socket.join(room);

    socket.emit("roomCreated", room);

    console.log("Room créée :", room, "par", adminEmail);
  });

  // 🔹 inscription professeur
  socket.on("registerAdmin", (data, callback) => {
    const email = (data.email || "").trim().toLowerCase();
    const password = data.password || "";
    const firstName = (data.firstName || "").trim();
    const lastName = (data.lastName || "").trim();

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

  // 🔹 connexion professeur
  socket.on("loginAdmin", (data, callback) => {
    const email = (data.email || "").trim().toLowerCase();
    const password = data.password || "";

    const account = adminAccounts[email];
    if (!account || account.password !== password) {
      callback({ success: false, message: "Email ou mot de passe incorrect." });
      return;
    }

    callback({ success: true, user: { email: account.email, firstName: account.firstName, lastName: account.lastName } });
  });

  // 🔹 rejoindre une room
  socket.on("joinRoom", (data) => {
    const room = data.room;

    if (!rooms[room]) {
      socket.emit("errorRoom");
      return;
    }

    let userId;

    // ✅ si déjà existant (refresh)
    if (data.userId) {
      userId = data.userId;
    } else {
      userId = generateUserId(room);
    }

    const profile = {};
    const firstName = typeof data.firstName === "string" ? data.firstName.trim() : "";
    const lastName = typeof data.lastName === "string" ? data.lastName.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";

    if (firstName) profile.firstName = firstName;
    if (lastName) profile.lastName = lastName;
    if (email) profile.email = email;

    socket.join(room);

    const player = {
      socketId: socket.id,
      userId: userId,
      profile,
      useWebcam: data.useWebcam || false
    };

    if (!rooms[room].answers[userId] || typeof rooms[room].answers[userId] !== "object") {
      rooms[room].answers[userId] = {
        sessions: [],
        profile: {},
        emotions: {},
        ageData: null
      };
    }

    if (Object.keys(profile).length > 0) {
      rooms[room].answers[userId].profile = {
        ...rooms[room].answers[userId].profile,
        ...profile
      };
    }

    rooms[room].players.push(player);

    // Start face recognition if webcam is enabled
    if (data.useWebcam) {
      console.log(`Starting face recognition for user ${userId} in room ${room}`);
      const pythonProcess = spawn('python', ['face_recognition.py'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdoutBuffer = "";
      pythonProcess.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop();

        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const output = JSON.parse(trimmed);
            console.log(`[PYTHON OUTPUT] Raw from Python:`, output);
            if (output.emotions || output.average_age !== null) {
              console.log(`[EMOTION DETECTED] For ${userId}: emotions=`, Object.keys(output.emotions || {}), ` age=${output.average_age}`);
              // Update the user's data
              if (rooms[room] && rooms[room].answers[userId]) {
                rooms[room].answers[userId].emotions = output.emotions || {};
                rooms[room].answers[userId].ageData = output.average_age;
              }
              // Send real-time updates to the specific user
              socket.emit("emotionUpdate", {
                emotions: output.emotions || {},
                age: output.average_age
              });
            }
          } catch (e) {
            // Ignore non-JSON lines
            console.log(`[PARSE ERROR] Could not parse line: "${trimmed}"`);
          }
        });
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error(`Face recognition stderr for user ${userId}:`, data.toString());
      });

      pythonProcess.on('close', (code) => {
        console.log(`Face recognition process for user ${userId} exited with code ${code}`);
        delete pythonProcesses[socket.id];
      });

      // Store the process reference to kill it later
      player.pythonProcess = pythonProcess;
      pythonProcesses[socket.id] = pythonProcess;
    }

    socket.emit("joinedRoom", {
      room: room,
      userId: userId
    });

      if (rooms[room].closed) {
        socket.emit("roomClosed", {
          room,
          results: rooms[room].finalResults
        });
      }

  });

  // 🔹 envoyer questions (admin)
socket.on("sendQuestions", (room) => {
  const questions = getRandomQuestions(5);
  rooms[room].currentQuestions = questions;
  io.to(room).emit("questions", questions);
});

  // 🔹 réponses joueurs
  socket.on("answers", (data) => {

    const { room, userId, answers } = data;

    if (!rooms[room]) return;

    // ❌ sécurité : refuser réponses incomplètes
    if (answers.includes(null)) {
      console.log("Réponses incomplètes refusées");
      return;
    }

    if (!rooms[room].answers[userId]) {
      rooms[room].answers[userId] = {
        sessions: []
      };
    }

    rooms[room].answers[userId].sessions.push({
      answers: [...answers], // 🔥 copie propre
      questions: [...rooms[room].currentQuestions] // 🔥 snapshot propre
    });


    console.log("Room:", room);
    console.log("User:", userId);
    console.log("Réponses stockées:", rooms[room].answers[userId]);

  });

  function convertAnswer(ans) {
    const map = {
      a: -2,
      b: -1,
      c: 0,
      d: 1,
      e: 2
    };

    return map[ans] ?? 0;
  }

  function getCategoryList() {
    return questionsData.questionnaire.metadata.categories || Object.values(questionsData.questionnaire.questions).map(q => q.category).filter((v, i, a) => a.indexOf(v) === i);
  }

  function computeScores(room, userId) {
    const userData = rooms[room].answers[userId];
    if (!userData) return null;

    const totals = {};
    const counts = {};
    const categories = getCategoryList();

    categories.forEach(cat => {
      totals[cat] = 0;
      counts[cat] = 0;
    });

    const sessions = Array.isArray(userData.sessions) ? userData.sessions : [];
    sessions.forEach(session => {
      if (!session || !Array.isArray(session.answers)) return;
      session.answers.forEach((ans, i) => {
        if (!ans) return;

        const question = session.questions[i];
        if (!question) return;

        let value = convertAnswer(ans);
        if (question.reversed) {
          value = -value;
        }

        const category = question.category;
        totals[category] += value;
        counts[category]++;
      });
    });

    const scores = {};
    categories.forEach(cat => {
      scores[cat] = counts[cat] > 0 ? Number((totals[cat] / counts[cat]).toFixed(2)) : null;
    });

    return scores;
  }

  function computeRoomOverview(room) {
    const totals = {};
    const counts = {};
    const categories = getCategoryList();

    categories.forEach(cat => {
      totals[cat] = 0;
      counts[cat] = 0;
    });

    for (const userId in rooms[room].answers) {
      const userData = rooms[room].answers[userId];
      const sessions = Array.isArray(userData.sessions) ? userData.sessions : [];
      sessions.forEach(session => {
        if (!session || !Array.isArray(session.answers)) return;
        session.answers.forEach((ans, i) => {
          if (!ans) return;

          const question = session.questions[i];
          if (!question) return;

          let value = convertAnswer(ans);
          if (question.reversed) {
            value = -value;
          }

          const category = question.category;
          totals[category] += value;
          counts[category]++;
        });
      });
    }

    const overview = {};
    categories.forEach(cat => {
      overview[cat] = counts[cat] > 0 ? Number((totals[cat] / counts[cat]).toFixed(2)) : null;
    });

    return overview;
  }

  function buildResultsPayload(room) {
    const users = {};
    for (const userId in rooms[room].answers) {
      users[userId] = {
        scores: computeScores(room, userId),
        profile: rooms[room].answers[userId].profile || {},
        emotions: rooms[room].answers[userId].emotions || {},
        age: rooms[room].answers[userId].ageData
      };
    }

    return {
      room,
      categories: getCategoryList(),
      users,
      overall: computeRoomOverview(room)
    };
  }

  // 🔹 fermer salle
  socket.on("closeRoom", (room) => {
    if (!rooms[room]) return;

    const payload = buildResultsPayload(room);
    const participantCount = Object.keys(rooms[room].answers).length;

    // Sauvegarder les résultats de manière permanente
    if (!roomHistory[rooms[room].adminEmail]) {
      roomHistory[rooms[room].adminEmail] = [];
    }

    roomHistory[rooms[room].adminEmail].push({
      room,
      createdAt: rooms[room].createdAt,
      closedAt: new Date(),
      participantCount,
      results: payload
    });

    rooms[room].closed = true;
    rooms[room].finalResults = payload;

    io.to(room).emit("roomClosed", {
      room,
      results: payload
    });

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
    const history = roomHistory[adminEmail] || [];
    // Trier par date de création (plus récent en premier)
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    callback(history);
  });

  socket.on("getHistoricalResults", (data, callback) => {
    const { adminEmail, room } = data;
    const history = roomHistory[adminEmail] || [];
    const roomData = history.find(h => h.room === room);
    if (roomData) {
      callback(roomData.results);
    } else {
      callback(null);
    }
  });

  socket.on("disconnect", () => {
    // Remove player from room and kill any running Python processes
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        // Kill Python process if it exists
        if (player.pythonProcess) {
          player.pythonProcess.kill();
          console.log(`Killed face recognition process for user ${player.userId}`);
          delete pythonProcesses[socket.id];
        }
        room.players.splice(playerIndex, 1);
        break;
      }
    }
  });

  // Debug logging from client
  socket.on("debugLog", (message) => {
    console.log("CLIENT DEBUG:", message);
  });

  // Receive video frames from client and send to Python for analysis
  let frameCount = 0;
  socket.on("analyzeFrame", (data) => {
    frameCount++;
    if (frameCount % 5 === 0) { // Log every 5th frame to avoid spam
      console.log(`[analyzeFrame #${frameCount}] Received from socket ${socket.id}`);
    }
    
    if (!pythonProcesses[socket.id]) {
      if (frameCount === 1) console.log("WARNING: No Python process found for socket:", socket.id);
      return;
    }
    
    const pythonProcess = pythonProcesses[socket.id];
    
    try {
      // Send frame to Python process via stdin
      const frameData = JSON.stringify({
        frame: data.frame
      });
      const written = pythonProcess.stdin.write(frameData + '\n');
      if (frameCount % 5 === 0) {
        console.log(`[analyzeFrame #${frameCount}] Sent to Python, buffer ok: ${written}`);
      }
      if (!written) {
        console.warn("Frame write buffer full, Python may be slow to process");
      }
    } catch (e) {
      console.error("Error sending frame to Python:", e);
    }
  });

});

server.listen(3000, () => {
  console.log("Serveur lancé sur http://localhost:3000");
});