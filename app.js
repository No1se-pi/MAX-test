(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const ui = {
    card: document.querySelector(".login-card"),
    form: byId("loginForm"),
    room: byId("roomInput"),
    login: byId("loginInput"),
    password: byId("passwordInput"),
    code: byId("codeInput"),
    consent: byId("consentInput"),
    roomError: byId("roomError"),
    loginError: byId("loginError"),
    passwordError: byId("passwordError"),
    codeError: byId("codeError"),
    consentError: byId("consentError"),
    status: byId("formStatus"),
    submit: byId("submitButton"),
    fillDemo: byId("fillDemoButton"),
    togglePassword: byId("togglePassword"),
    success: byId("successCard"),
    tryAgain: byId("tryAgainButton"),
  };

  const queryRoom = new URLSearchParams(window.location.search).get("room");
  if (queryRoom) {
    ui.room.value = queryRoom.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function setError(input, output, message) {
    input.classList.toggle("is-invalid", Boolean(message));
    input.setAttribute("aria-invalid", String(Boolean(message)));
    output.textContent = message;
  }

  function clearErrors() {
    setError(ui.room, ui.roomError, "");
    setError(ui.login, ui.loginError, "");
    setError(ui.password, ui.passwordError, "");
    setError(ui.code, ui.codeError, "");
    ui.consentError.textContent = "";
    ui.status.textContent = "";
    ui.status.className = "form-status";
  }

  function values() {
    return {
      room: ui.room.value.trim().toUpperCase(),
      login: ui.login.value.trim(),
      password: ui.password.value,
      code: ui.code.value.replace(/\s/g, ""),
    };
  }

  function validate(data) {
    clearErrors();
    let valid = true;

    if (!/^[A-Z0-9]{6}$/.test(data.room)) {
      setError(ui.room, ui.roomError, "Введите шестизначный код занятия.");
      valid = false;
    }
    if (!/^demo-[a-zA-Z0-9_-]{2,24}$/.test(data.login)) {
      setError(ui.login, ui.loginError, "Используйте только учебный логин вида demo-name.");
      valid = false;
    }
    if (data.password.length < 3) {
      setError(ui.password, ui.passwordError, "Придумайте учебный пароль длиной от трёх символов.");
      valid = false;
    }
    if (!/^\d{4,8}$/.test(data.code)) {
      setError(ui.code, ui.codeError, "Введите от четырёх до восьми цифр.");
      valid = false;
    }
    if (!ui.consent.checked) {
      ui.consentError.textContent = "Нужно разрешение на показ вымышленных данных.";
      valid = false;
    }
    return valid;
  }

  ui.room.addEventListener("input", () => {
    ui.room.value = ui.room.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  ui.code.addEventListener("input", () => {
    const digits = ui.code.value.replace(/\D/g, "").slice(0, 6);
    ui.code.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  });

  ui.togglePassword.addEventListener("click", () => {
    const visible = ui.password.type === "text";
    ui.password.type = visible ? "password" : "text";
    ui.togglePassword.setAttribute("aria-label", visible ? "Показать пароль" : "Скрыть пароль");
  });

  ui.fillDemo.addEventListener("click", () => {
    const suffix = Math.random().toString(36).slice(2, 6);
    ui.login.value = `demo-${suffix}`;
    ui.password.value = `not-real-${Math.floor(100 + Math.random() * 900)}`;
    ui.code.value = "000 000";
    ui.consent.checked = true;
    clearErrors();
  });

  ui.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = values();
    if (!validate(data)) return;

    ui.submit.disabled = true;
    ui.submit.textContent = "Отправляем…";
    ui.status.textContent = "Проверяем комнату ведущего…";

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(data.room)}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: data.login, password: data.password, code: data.code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось отправить данные.");

      ui.card.hidden = true;
      ui.success.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      ui.status.textContent = error.message;
      ui.status.className = "form-status is-error";
    } finally {
      ui.submit.disabled = false;
      ui.submit.textContent = "Продолжить";
    }
  });

  ui.tryAgain.addEventListener("click", () => {
    const room = ui.room.value;
    ui.form.reset();
    ui.room.value = room;
    ui.password.type = "password";
    clearErrors();
    ui.success.hidden = true;
    ui.card.hidden = false;
    ui.login.focus();
  });
})();
