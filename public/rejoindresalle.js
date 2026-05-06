const socket = io();
const roomCode = document.getElementById("roomCode");
const codeError = document.getElementById("codeError");
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const emailInput = document.getElementById("email");
const enableCam = document.getElementById("enableCam");
const noCam = document.getElementById("noCam");
const videoBox = document.getElementById("videoBox");
const video = document.getElementById("video");

console.log("rejoindresalle.js loaded");

let useCamera = true;

/* TOGGLE OPTIONS */
enableCam.onclick = () => {
  enableCam.classList.add("active");
  noCam.classList.remove("active");
  useCamera = true;
};

noCam.onclick = () => {
  noCam.classList.add("active");
  enableCam.classList.remove("active");
  useCamera = false;
  stopCamera();
};

/* VALIDATION CODE SALLE */
roomCode.addEventListener("input", () => {
  if(roomCode.value.length !== 5){
    codeError.textContent = "Le code doit contenir exactement 5 caractères";
  } else {
    codeError.textContent = "";
  }
});

/* BOUTON REJOINDRE */
document.getElementById("joinBtn").onclick = async () => {

  console.log("Join button clicked, roomCode:", roomCode.value, "useCamera:", useCamera);

  if(roomCode.value.length !== 5){
    alert("Code de salle invalide (5 caractères requis)");
    return;
  }

  const firstName = firstNameInput?.value.trim() || "";
  const lastName = lastNameInput?.value.trim() || "";
  const email = emailInput?.value.trim() || "";

  const profileData = {
    firstName,
    lastName,
    email
  };

  if(useCamera){
    const consent = confirm(
      "Autorisez-vous l’accès à la webcam pour la détection d'émotions ?"
    );

    if(!consent){
      alert("Veuillez utiliser le mode questionnaire.");
      return;
    }

    // Start camera immediately for preview, but let the secondary page start emotion capture.
    await startCamera();

    // Join room without starting face recognition on this temporary socket.
    socket.emit("joinRoom", {
      room: roomCode.value,
      useWebcam: false,
      ...profileData
    });

    socket.once("joinedRoom", (data) => {
      console.log("joinedRoom received, redirecting to secondary.html with data:", data);
      // Go to secondaire with webcam detection and userId
      window.location.href = "secondaire.html?room=" + data.room + "&userId=" + data.userId + "&useWebcam=true";
    });

    socket.on("errorRoom", () => {
      console.log("errorRoom received, room does not exist");
      alert("Salle inexistante");
      stopCamera();
      window.location.href = "/";
    });
  } else {
    // Join room for quiz without webcam
    socket.emit("joinRoom", {
      room: roomCode.value,
      useWebcam: false,
      ...profileData
    });

    socket.once("joinedRoom", (data) => {
      console.log("joinedRoom received for no webcam, redirecting to secondary.html with data:", data);
      // Go to secondaire without webcam
      window.location.href = "secondaire.html?room=" + data.room + "&userId=" + data.userId + "&useWebcam=false";
    });

    socket.on("errorRoom", () => {
      console.log("errorRoom received, room does not exist");
      alert("Salle inexistante");
      window.location.href = "/";
    });
  }
};

/* WEBCAM */
async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video:true });
    video.srcObject = stream;
    videoBox.classList.remove("hidden");
  }catch(e){
    alert("Impossible d'accéder à la webcam.");
  }
}

function stopCamera(){
  if(video.srcObject){
    video.srcObject.getTracks().forEach(t => t.stop());
  }
  videoBox.classList.add("hidden");
}