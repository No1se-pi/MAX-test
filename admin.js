(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const ui = {
    status: byId("connectionStatus"),
    start: byId("startPanel"),
    dashboard: byId("dashboard"),
    create: byId("createRoomButton"),
    startError: byId("startError"),
    roomCode: byId("roomCode"),
    participantLink: byId("participantLink"),
    copyLink: byId("copyLinkButton"),
    toggleReceiving: byId("toggleReceivingButton"),
    count: byId("submissionCount"),
    empty: byId("emptyState"),
    grid: byId("submissionGrid"),
    clear: byId("clearResultsButton"),
    end: byId("endRoomButton"),
  };

  let room = "";
  let accepting = false;
  let eventSource = null;
  let submissions = [];

  function setStatus(text, mode = "") {
    ui.status.className = `connection-status ${mode}`.trim();
    ui.status.innerHTML = "";
    const dot = document.createElement("span");
    ui.status.append(dot, document.createTextNode(` ${text}`));
  }

  function participantUrl(roomCode) {
    const url = new URL("./", window.location.href);
    url.hash = "";
    url.search = `?room=${encodeURIComponent(roomCode)}`;
    return url.href;
  }

  function masked(value) {
    return "•".repeat(Math.min(value.length, 18));
  }

  function addValueRow(label, value, revealable = false) {
    const row = document.createElement("div");
    row.className = "result-row";
    const title = document.createElement("span");
    title.textContent = label;
    const content = document.createElement("code");
    content.textContent = revealable ? masked(value) : value;
    row.append(title, content);

    if (revealable) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Показать";
      button.addEventListener("click", () => {
        const revealed = button.dataset.revealed === "true";
        button.dataset.revealed = String(!revealed);
        button.textContent = revealed ? "Показать" : "Скрыть";
        content.textContent = revealed ? masked(value) : value;
      });
      row.append(button);
    }
    return row;
  }

  function render() {
    ui.grid.innerHTML = "";
    ui.count.textContent = String(submissions.length);
    ui.empty.hidden = submissions.length > 0;

    submissions.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "submission-card";

      const header = document.createElement("header");
      const number = document.createElement("strong");
      number.textContent = `Участник ${String(index + 1).padStart(2, "0")}`;
      const time = document.createElement("time");
      time.dateTime = item.receivedAt;
      time.textContent = new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(item.receivedAt));
      header.append(number, time);

      const values = document.createElement("div");
      values.className = "result-values";
      values.append(
        addValueRow("Логин", item.login),
        addValueRow("Пароль", item.password, true),
        addValueRow("Код", item.code)
      );
      card.append(header, values);
      ui.grid.prepend(card);
    });
  }

  function showDashboard() {
    ui.start.hidden = true;
    ui.dashboard.hidden = false;
    ui.roomCode.textContent = room;
    ui.participantLink.textContent = participantUrl(room);
    window.location.hash = `room=${room}`;
  }

  function connectEvents() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/rooms/${encodeURIComponent(room)}/events`);
    setStatus("Подключаем экран…");

    eventSource.addEventListener("ready", (event) => {
      const data = JSON.parse(event.data);
      accepting = Boolean(data.accepting);
      ui.toggleReceiving.textContent = accepting ? "Остановить приём" : "Разрешить приём";
      ui.toggleReceiving.classList.toggle("is-active", accepting);
      setStatus(accepting ? "Приём включён" : "Ожидает разрешения", accepting ? "is-live" : "");
    });

    eventSource.addEventListener("submission", (event) => {
      submissions.push(JSON.parse(event.data));
      render();
    });

    eventSource.addEventListener("room-ended", () => resetDashboard("Комната завершена."));
    eventSource.onerror = () => setStatus("Переподключаемся…", "is-error");
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Ошибка сервера.");
    return data;
  }

  async function createRoom() {
    ui.create.disabled = true;
    ui.startError.textContent = "";
    try {
      const data = await request("/api/rooms", { method: "POST", body: "{}" });
      room = data.room;
      submissions = [];
      showDashboard();
      render();
      connectEvents();
    } catch (error) {
      ui.startError.textContent = error.message;
    } finally {
      ui.create.disabled = false;
    }
  }

  async function restoreRoom(roomCode) {
    try {
      const data = await request(`/api/rooms/${encodeURIComponent(roomCode)}/admin`);
      room = data.room;
      accepting = data.accepting;
      showDashboard();
      render();
      connectEvents();
    } catch {
      window.location.hash = "";
    }
  }

  function resetDashboard(message = "Комната не запущена") {
    if (eventSource) eventSource.close();
    eventSource = null;
    room = "";
    accepting = false;
    submissions = [];
    render();
    ui.dashboard.hidden = true;
    ui.start.hidden = false;
    window.location.hash = "";
    setStatus(message);
  }

  ui.create.addEventListener("click", createRoom);

  ui.copyLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ui.participantLink.textContent);
      ui.copyLink.textContent = "Скопировано";
      window.setTimeout(() => { ui.copyLink.textContent = "Копировать"; }, 1400);
    } catch {
      ui.copyLink.textContent = "Выделите ссылку";
    }
  });

  ui.toggleReceiving.addEventListener("click", async () => {
    ui.toggleReceiving.disabled = true;
    try {
      const data = await request(`/api/rooms/${encodeURIComponent(room)}`, {
        method: "PATCH",
        body: JSON.stringify({ accepting: !accepting }),
      });
      accepting = data.accepting;
      ui.toggleReceiving.textContent = accepting ? "Остановить приём" : "Разрешить приём";
      ui.toggleReceiving.classList.toggle("is-active", accepting);
      setStatus(accepting ? "Приём включён" : "Приём остановлен", accepting ? "is-live" : "");
    } catch (error) {
      setStatus(error.message, "is-error");
    } finally {
      ui.toggleReceiving.disabled = false;
    }
  });

  ui.clear.addEventListener("click", () => {
    submissions = [];
    render();
  });

  ui.end.addEventListener("click", async () => {
    try {
      await request(`/api/rooms/${encodeURIComponent(room)}`, { method: "DELETE" });
    } finally {
      resetDashboard();
    }
  });

  const hashRoom = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("room");
  if (hashRoom && /^[A-Z0-9]{6}$/.test(hashRoom)) restoreRoom(hashRoom);
})();
