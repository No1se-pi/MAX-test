(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);

  const ui = {
    modeBadge: byId("modeBadge"),
    bridgeStatus: byId("bridgeStatus"),
    platform: byId("platform"),
    version: byId("version"),
    device: byId("device"),
    avatar: byId("avatar"),
    userName: byId("userName"),
    userMeta: byId("userMeta"),
    testButton: byId("testButton"),
    counter: byId("counter"),
    debugOutput: byId("debugOutput"),
  };

  const webApp = window.WebApp;
  const isInsideMax = Boolean(webApp);

  function safeValue(value, fallback = "Не передано") {
    return value === undefined || value === null || value === ""
      ? fallback
      : String(value);
  }

  function renderEnvironment() {
    if (!isInsideMax) {
      ui.modeBadge.textContent = "Демо-режим в браузере";
      ui.modeBadge.classList.add("demo");
      ui.bridgeStatus.textContent = "Не обнаружен";
      ui.platform.textContent = "Обычный браузер";
      ui.version.textContent = "—";
      ui.device.textContent = navigator.userAgent;
      ui.debugOutput.textContent = JSON.stringify(
        {
          insideMax: false,
          note: "Это нормально. Для получения данных Bridge откройте URL внутри MAX.",
          userAgent: navigator.userAgent,
        },
        null,
        2
      );
      return;
    }

    ui.modeBadge.textContent = "Запущено внутри MAX";
    ui.modeBadge.classList.add("success");
    ui.bridgeStatus.textContent = "Подключён";
    ui.platform.textContent = safeValue(webApp.platform);
    ui.version.textContent = safeValue(webApp.version);
    ui.device.textContent = safeValue(webApp.deviceName);

    const initData = webApp.initDataUnsafe || {};
    const user = initData.user || {};

    const fullName = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    ui.userName.textContent = fullName || "Пользователь MAX";

    const meta = [
      user.username ? `@${user.username}` : null,
      user.id ? `ID: ${user.id}` : null,
      user.language_code ? `Язык: ${user.language_code}` : null,
    ].filter(Boolean);

    ui.userMeta.textContent = meta.length
      ? meta.join(" · ")
      : "Пользовательские данные не переданы.";

    if (user.photo_url) {
      ui.avatar.src = user.photo_url;
      ui.avatar.hidden = false;
    }

    ui.debugOutput.textContent = JSON.stringify(
      {
        insideMax: true,
        platform: webApp.platform,
        version: webApp.version,
        deviceName: webApp.deviceName,
        initDataUnsafe: initData,
        initDataPresent: Boolean(webApp.initData),
      },
      null,
      2
    );
  }

  let count = 0;

  ui.testButton.addEventListener("click", () => {
    count += 1;
    ui.counter.textContent = String(count);
    ui.testButton.textContent =
      count === 1 ? "Работает!" : `Работает × ${count}`;
  });

  window.addEventListener("error", (event) => {
    ui.debugOutput.textContent += `\n\nОшибка: ${event.message}`;
  });

  renderEnvironment();
})();
