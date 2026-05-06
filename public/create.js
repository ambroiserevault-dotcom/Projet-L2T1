document.addEventListener("DOMContentLoaded", function () {

  const copyBtn     = document.getElementById("copyBtn");
  const roomCode    = document.getElementById("roomCode");
  const message     = document.getElementById("copyMessage");
  const voirSalleBtn = document.getElementById("voirSalleBtn");

  // ===== COPIE DU CODE =====
  if (copyBtn) {
    copyBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const code = roomCode.innerText.trim();
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, 99999);
      document.execCommand("copy");
      document.body.removeChild(textarea);

      message.innerText = "Code copié ✅ avec succès";
      message.style.display = "block";
      setTimeout(() => { message.style.display = "none"; }, 2500);
    });
  }

  // ===== LIEN VOIR LA SALLE =====
  if (voirSalleBtn && roomCode) {
    const code = roomCode.innerText.trim();
    if (code) voirSalleBtn.href = "salle.html?room=" + code;
  }

});