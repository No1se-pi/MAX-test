import { createServer as createHttpServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 10_000;
const MAX_BODY_BYTES = 8 * 1024;

const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/admin", "admin.html"],
  ["/admin.html", "admin.html"],
  ["/app.js", "app.js"],
  ["/admin.js", "admin.js"],
  ["/style.css", "style.css"],
  ["/public/favicon.svg", "public/favicon.svg"],
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors https://*.max.ru https://max.ru",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  response.writeHead(statusCode, { ...securityHeaders(), ...extraHeaders });
  response.end(JSON.stringify(value));
}

function normalizeRoom(value) {
  return String(value || "").trim().toUpperCase();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((entry) => entry.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function roomCookie(request, room, token) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "");
  const secure = forwardedProto === "https" ? "; Secure" : "";
  return `tyndex_admin=${encodeURIComponent(`${room}.${token}`)}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function expiredRoomCookie(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "");
  const secure = forwardedProto === "https" ? "; Secure" : "";
  return `tyndex_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === request.headers.host;
  } catch {
    return false;
  }
}

async function readJson(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    throw Object.assign(new Error("Ожидается JSON."), { statusCode: 415 });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Слишком большой запрос."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Некорректный JSON."), { statusCode: 400 });
  }
}

function createRoomCode(rooms) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    const bytes = randomBytes(6);
    for (const byte of bytes) code += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error("Не удалось создать код комнаты.");
}

function adminRoom(request, rooms, roomCode) {
  const cookie = parseCookies(request).tyndex_admin || "";
  const separator = cookie.indexOf(".");
  if (separator < 0) return null;
  const cookieRoom = cookie.slice(0, separator);
  const token = cookie.slice(separator + 1);
  const room = rooms.get(roomCode);
  if (!room || cookieRoom !== roomCode || !safeEqual(token, room.adminToken)) return null;
  return room;
}

function sendEvent(response, name, data) {
  response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function validateSubmission(value) {
  const login = String(value.login || "").trim();
  const password = String(value.password || "");
  const code = String(value.code || "").replace(/\s/g, "");

  if (!/^demo-[a-zA-Z0-9_-]{2,24}$/.test(login)) {
    throw Object.assign(new Error("Допустим только учебный логин вида demo-name."), { statusCode: 400 });
  }
  if (password.length < 3 || password.length > 40) {
    throw Object.assign(new Error("Учебный пароль должен содержать от 3 до 40 символов."), { statusCode: 400 });
  }
  if (!/^\d{4,8}$/.test(code)) {
    throw Object.assign(new Error("Учебный код должен содержать от 4 до 8 цифр."), { statusCode: 400 });
  }
  return { login, password, code };
}

export function createAppServer() {
  const rooms = new Map();

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.createdAt > ROOM_TTL_MS) {
        if (room.stream) sendEvent(room.stream, "room-ended", { reason: "expired" });
        room.stream?.end();
        rooms.delete(code);
        continue;
      }
      if (room.stream) room.stream.write(": heartbeat\n\n");
    }
  }, 15_000);
  heartbeat.unref();

  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return sendJson(response, 200, { ok: true, activeRooms: rooms.size });
      }

      if (url.pathname.startsWith("/api/") && !isSameOrigin(request)) {
        return sendJson(response, 403, { error: "Запрос с другого сайта запрещён." });
      }

      if (url.pathname === "/api/rooms" && request.method === "POST") {
        await readJson(request);
        const roomCode = createRoomCode(rooms);
        const adminToken = randomBytes(32).toString("base64url");
        rooms.set(roomCode, {
          adminToken,
          accepting: false,
          stream: null,
          reconnectTimer: null,
          createdAt: Date.now(),
          recentSubmissions: [],
        });
        return sendJson(response, 201, { room: roomCode }, {
          "Set-Cookie": roomCookie(request, roomCode, adminToken),
        });
      }

      const adminMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/admin$/);
      if (adminMatch && request.method === "GET") {
        const roomCode = normalizeRoom(adminMatch[1]);
        const room = adminRoom(request, rooms, roomCode);
        if (!room) return sendJson(response, 401, { error: "Администратор комнаты не найден." });
        return sendJson(response, 200, { room: roomCode, accepting: room.accepting });
      }

      const eventsMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/events$/);
      if (eventsMatch && request.method === "GET") {
        const roomCode = normalizeRoom(eventsMatch[1]);
        const room = adminRoom(request, rooms, roomCode);
        if (!room) return sendJson(response, 401, { error: "Нет доступа к комнате." });

        if (room.reconnectTimer) clearTimeout(room.reconnectTimer);
        if (room.stream && room.stream !== response) room.stream.end();
        room.stream = response;
        response.writeHead(200, {
          ...securityHeaders("text/event-stream; charset=utf-8"),
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write("retry: 1500\n\n");
        sendEvent(response, "ready", { room: roomCode, accepting: room.accepting });

        request.on("close", () => {
          if (room.stream !== response) return;
          room.stream = null;
          room.reconnectTimer = setTimeout(() => {
            if (!room.stream) rooms.delete(roomCode);
          }, RECONNECT_GRACE_MS);
          room.reconnectTimer.unref();
        });
        return;
      }

      const submissionMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/submissions$/);
      if (submissionMatch && request.method === "POST") {
        const roomCode = normalizeRoom(submissionMatch[1]);
        const room = rooms.get(roomCode);
        if (!room || !room.stream) return sendJson(response, 404, { error: "Ведущий ещё не открыл эту комнату." });
        if (!room.accepting) return sendJson(response, 409, { error: "Ведущий пока не разрешил приём." });

        const now = Date.now();
        room.recentSubmissions = room.recentSubmissions.filter((time) => now - time < 60_000);
        if (room.recentSubmissions.length >= 60) {
          return sendJson(response, 429, { error: "Слишком много отправок. Попробуйте через минуту." });
        }

        const data = validateSubmission(await readJson(request));
        room.recentSubmissions.push(now);
        sendEvent(room.stream, "submission", {
          id: randomUUID(),
          ...data,
          receivedAt: new Date(now).toISOString(),
        });
        return sendJson(response, 202, { accepted: true });
      }

      const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})$/);
      if (roomMatch && request.method === "GET") {
        const roomCode = normalizeRoom(roomMatch[1]);
        const room = rooms.get(roomCode);
        return sendJson(response, room && room.stream ? 200 : 404, {
          active: Boolean(room?.stream),
          accepting: Boolean(room?.accepting),
        });
      }

      if (roomMatch && request.method === "PATCH") {
        const roomCode = normalizeRoom(roomMatch[1]);
        const room = adminRoom(request, rooms, roomCode);
        if (!room) return sendJson(response, 401, { error: "Нет доступа к комнате." });
        const body = await readJson(request);
        room.accepting = body.accepting === true;
        return sendJson(response, 200, { room: roomCode, accepting: room.accepting });
      }

      if (roomMatch && request.method === "DELETE") {
        const roomCode = normalizeRoom(roomMatch[1]);
        const room = adminRoom(request, rooms, roomCode);
        if (!room) return sendJson(response, 401, { error: "Нет доступа к комнате." });
        if (room.stream) sendEvent(room.stream, "room-ended", { reason: "admin" });
        room.stream?.end();
        rooms.delete(roomCode);
        return sendJson(response, 200, { ended: true }, { "Set-Cookie": expiredRoomCookie(request) });
      }

      if (request.method === "GET" && staticFiles.has(url.pathname)) {
        const filename = staticFiles.get(url.pathname);
        const filePath = resolve(projectRoot, filename);
        const body = await readFile(filePath);
        const headers = securityHeaders(mimeTypes[extname(filePath)] || "application/octet-stream");
        if (extname(filePath) !== ".html") headers["Cache-Control"] = "public, max-age=300";
        response.writeHead(200, headers);
        return response.end(body);
      }

      sendJson(response, 404, { error: "Страница не найдена." });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Внутренняя ошибка сервера.",
      });
    }
  });

  server.on("close", () => clearInterval(heartbeat));
  return server;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPath) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "0.0.0.0";
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`Тындекс мастер-класс: http://localhost:${port}`);
    console.log(`Экран ведущего: http://localhost:${port}/admin`);
  });
}
