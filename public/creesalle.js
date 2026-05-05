const emailInput = document.getElementById("email");
const submitBtn = document.getElementById("submitBtn");
const errorMessage = document.getElementById("errorMessage");

const emailRegex = /^[a-z]+\.[a-z]+@u-paris\.fr$/;

// Validation en temps réel du mail
emailInput.addEventListener("input", () => {
  if (!emailRegex.test(emailInput.value)) {
    emailInput.classList.add("error-input");
  } else {
    emailInput.classList.remove("error-input");
  }
});

// Validation globale avant navigation
/*
submitBtn.addEventListener("click", (event) => {
  const inputs = document.querySelectorAll("input");
  let valid = true;

  inputs.forEach(input => {
    if (input.value.trim() === "") {
      input.classList.add("error-input");
      valid = false;
    } else {
      input.classList.remove("error-input");
    }
  });

  if (!emailRegex.test(emailInput.value)) {
    emailInput.classList.add("error-input");
    valid = false;
  }

  if (!valid) {
    errorMessage.style.display = "block";
    event.preventDefault(); // bloque le lien
  } else {
    errorMessage.style.display = "none";
  }
});*/