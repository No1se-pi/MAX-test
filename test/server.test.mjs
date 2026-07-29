import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.mjs";

async function startServer() {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function readSseEvent(reader, expectedEvent) {
  const decoder = new TextDecoder();
  let buffer = "";
  return (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`SSE closed before ${expectedEvent}`);
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop();
      for (const chunk of chunks) {
        const event = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (event === expectedEvent && data) return JSON.parse(data);
      }
    }
  })();
}

test("room forwards demo data only while admin allows receiving", async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => server.close());

  const createResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(createResponse.status, 201);
  const { room } = await createResponse.json();
  const cookie = createResponse.headers.get("set-cookie").split(";")[0];
  assert.match(room, /^[A-Z0-9]{6}$/);

  const eventsResponse = await fetch(`${baseUrl}/api/rooms/${room}/events`, {
    headers: { Cookie: cookie },
  });
  assert.equal(eventsResponse.status, 200);
  const reader = eventsResponse.body.getReader();
  assert.deepEqual(await readSseEvent(reader, "ready"), { room, accepting: false });

  const blockedResponse = await fetch(`${baseUrl}/api/rooms/${room}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "demo-alice", password: "fake-pass", code: "000000" }),
  });
  assert.equal(blockedResponse.status, 409);

  const toggleResponse = await fetch(`${baseUrl}/api/rooms/${room}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ accepting: true }),
  });
  assert.equal(toggleResponse.status, 200);

  const submissionEvent = readSseEvent(reader, "submission");
  const submitResponse = await fetch(`${baseUrl}/api/rooms/${room}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "demo-alice", password: "fake-pass", code: "000000" }),
  });
  assert.equal(submitResponse.status, 202);
  assert.deepEqual(
    Object.fromEntries(Object.entries(await submissionEvent).filter(([key]) => ["login", "password", "code"].includes(key))),
    { login: "demo-alice", password: "fake-pass", code: "000000" }
  );

  const realLoginResponse = await fetch(`${baseUrl}/api/rooms/${room}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "person@example.com", password: "secret", code: "123456" }),
  });
  assert.equal(realLoginResponse.status, 400);

  await reader.cancel();
});

test("serves participant and admin pages with security headers", async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => server.close());

  for (const path of ["/", "/admin"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
  }
});
