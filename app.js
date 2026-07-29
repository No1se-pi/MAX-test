(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);

  const ui = {
    tabs: Array.from(document.querySelectorAll("[data-tab]")),
    authPanel: byId("authPanel"),
    dataPanel: byId("dataPanel"),
    form: byId("loginForm"),
    login: byId("loginInput"),
    password: byId("passwordInput"),
    code: byId("codeInput"),
    consent: byId("consentInput"),
    loginError: byId("loginError"),
    passwordError: byId("passwordError"),
    codeError: byId("codeError"),
    consentError: byId("consentError"),
    fillDemo: byId("fillDemoButton"),
    toggleInputPassword: byId("toggleInputPassword"),
    filledCounter: byId("filledCounter"),
    capturedLogin: byId("capturedLogin"),
    capturedPassword: byId("capturedPassword"),
    capturedCode: byId("capturedCode"),
    capturedTime: byId("capturedTime"),
    revealPassword: byId("revealPasswordButton"),
    back: byId("backButton"),
    clear: byId("clearButton"),
  };

  const state = {
    login: "",
    password: "",
    code: "",
    updatedAt: null,
    passwordRevealed: false,
  };

  const panels = {
    auth: ui.authPanel,
    data: ui.dataPanel,
  };

  function escapeMask(value) {
    if (!value) return "ещё не введён";
    return "•".repeat(Math.min(value.length, 16));
  }

  function formatTime(date) {
    return date
      ? new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(date)
      : "—";
  }

  function updateCapturedView() {
    const filledCount = [state.login, state.password, state.code].filter(Boolean).length;

    ui.filledCounter.textContent = String(filledCount);
    ui.filledCounter.classList.toggle("has-data", filledCount > 0);
    ui.capturedLogin.textContent = state.login || "ещё не введён";
    ui.capturedPassword.textContent = state.passwordRevealed
      ? state.password || "ещё не введён"
      : escapeMask(state.password);
    ui.capturedCode.textContent = state.code || "ещё не введён";
    ui.capturedTime.textContent = formatTime(state.updatedAt);
    ui.revealPassword.disabled = !state.password;
    ui.revealPassword.textContent = state.passwordRevealed ? "Скрыть" : "Показать";
  }

  function syncState() {
    state.login = ui.login.value.trim();
    state.password = ui.password.value;
    state.code = ui.code.value.trim();
    state.updatedAt = state.login || state.password || state.code ? new Date() : null;
    updateCapturedView();
  }

  function selectTab(tabName, focusTab = false) {
    ui.tabs.forEach((tab) => {
      const isSelected = tab.dataset.tab === tabName;
      tab.classList.toggle("is-active", isSelected);
      tab.setAttribute("aria-selected", String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;

      if (isSelected && focusTab) tab.focus();
    });

    Object.entries(panels).forEach(([name, panel]) => {
      const isSelected = name === tabName;
      panel.hidden = !isSelected;
      panel.classList.toggle("is-active", isSelected);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setError(input, errorElement, message) {
    input.classList.toggle("is-invalid", Boolean(message));
    input.setAttribute("aria-invalid", String(Boolean(message)));
    errorElement.textContent = message;
  }

  function clearErrors() {
    setError(ui.login, ui.loginError, "");
    setError(ui.password, ui.passwordError, "");
    setError(ui.code, ui.codeError, "");
    ui.consentError.textContent = "";
  }

  function validateForm() {
    clearErrors();
    let isValid = true;

    if (!state.login) {
      setError(ui.login, ui.loginError, "Введите вымышленный телефон или почту.");
      isValid = false;
    }

    if (!state.password) {
      setError(ui.password, ui.passwordError, "Введите вымышленный пароль.");
      isValid = false;
    }

    if (!state.code) {
      setError(ui.code, ui.codeError, "Введите вымышленный код.");
      isValid = false;
    }

    if (!ui.consent.checked) {
      ui.consentError.textContent = "Подтвердите, что используете только вымышленные данные.";
      isValid = false;
    }

    return isValid;
  }

  ui.tabs.forEach((tab, tabIndex) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (tabIndex + direction + ui.tabs.length) % ui.tabs.length;
      selectTab(ui.tabs[nextIndex].dataset.tab, true);
    });
  });

  [ui.login, ui.password, ui.code].forEach((input) => {
    input.addEventListener("input", () => {
      syncState();
      if (input.classList.contains("is-invalid")) clearErrors();
    });
  });

  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    syncState();
    if (validateForm()) selectTab("data", true);
  });

  ui.fillDemo.addEventListener("click", () => {
    ui.login.value = "student@tyndex.example";
    ui.password.value = "not-a-real-password";
    ui.code.value = "482 100";
    ui.consent.checked = true;
    clearErrors();
    syncState();
    ui.login.focus();
  });

  ui.toggleInputPassword.addEventListener("click", () => {
    const passwordIsVisible = ui.password.type === "text";
    ui.password.type = passwordIsVisible ? "password" : "text";
    ui.toggleInputPassword.setAttribute(
      "aria-label",
      passwordIsVisible ? "Показать пароль" : "Скрыть пароль"
    );
  });

  ui.revealPassword.addEventListener("click", () => {
    state.passwordRevealed = !state.passwordRevealed;
    updateCapturedView();
  });

  ui.back.addEventListener("click", () => selectTab("auth", true));

  ui.clear.addEventListener("click", () => {
    ui.form.reset();
    clearErrors();
    state.login = "";
    state.password = "";
    state.code = "";
    state.updatedAt = null;
    state.passwordRevealed = false;
    ui.password.type = "password";
    updateCapturedView();
    selectTab("auth", true);
    ui.login.focus();
  });

  updateCapturedView();
})();
