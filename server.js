const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const PUBLIC_DIR = path.join(__dirname, "public");
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const CERT_DIR = path.join(__dirname, "certs");
const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Map(),
      messages: [],
      callLog: [],
      nextMessageId: 1,
    });
  }

  return rooms.get(roomId);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(reqPath, res) {
  const safePath = reqPath === "/" ? "/index.html" : reqPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(contents);
  });
}

function handleEvents(req, res, url) {
  const roomId = url.searchParams.get("room");
  const clientId = url.searchParams.get("client");

  if (!roomId || !clientId) {
    sendJson(res, 400, { error: "room and client are required" });
    return;
  }

  const room = getRoom(roomId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("\n");

  room.clients.set(clientId, res);
  res.write(
    `data: ${JSON.stringify({
      type: "presence",
      peers: Array.from(room.clients.keys()),
      callLog: room.callLog,
    })}\n\n`
  );

  req.on("close", () => {
    room.clients.delete(clientId);
    broadcast(roomId, {
      type: "presence",
      peers: Array.from(room.clients.keys()),
    });
  });
}

function broadcast(roomId, message) {
  const room = getRoom(roomId);
  const event = {
    id: room.nextMessageId++,
    ...message,
    createdAt: Date.now(),
  };

  room.messages.push(event);
  if (room.messages.length > 200) {
    room.messages.shift();
  }

  const payload = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const [clientId, client] of room.clients.entries()) {
    if (event.to && event.to !== clientId) {
      continue;
    }
    if (event.from && event.from === clientId && event.type !== "presence") {
      continue;
    }
    client.write(payload);
  }
}

function addCallLog(roomId, entry) {
  const room = getRoom(roomId);
  room.callLog.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: Date.now(),
    ...entry,
  });

  if (room.callLog.length > 50) {
    room.callLog.shift();
  }
}

async function handleSignal(req, res, url) {
  const bodyText = await collectBody(req);
  let body;

  try {
    body = JSON.parse(bodyText || "{}");
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return;
  }

  const roomId = body.room || url.searchParams.get("room");
  const from = body.from;

  if (!roomId || !from || !body.type) {
    sendJson(res, 400, { error: "room, from, and type are required" });
    return;
  }

  if (body.type === "call-started") {
    addCallLog(roomId, {
      kind: "started",
      from: body.from,
      to: body.to || null,
    });
  }

  if (body.type === "hangup") {
    addCallLog(roomId, {
      kind: "ended",
      from: body.from,
      to: body.to || null,
    });
  }

  broadcast(roomId, body);
  sendJson(res, 202, { ok: true });
}

function handleHistory(res, url) {
  const roomId = url.searchParams.get("room");

  if (!roomId) {
    sendJson(res, 400, { error: "room is required" });
    return;
  }

  const room = getRoom(roomId);
  sendJson(res, 200, {
    room: roomId,
    callLog: room.callLog,
    messages: room.messages.filter((message) => message.type === "chat-message"),
  });
}

function hasTlsMaterial() {
  return (
    fs.existsSync(path.join(CERT_DIR, "localhost-key.pem")) &&
    fs.existsSync(path.join(CERT_DIR, "localhost-cert.pem"))
  );
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, https: hasTlsMaterial() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    handleEvents(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/history") {
    handleHistory(res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/signal") {
    try {
      await handleSignal(req, res, url);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET") {
    serveFile(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

const server = http.createServer(requestHandler);

server.listen(PORT, HOST, () => {
  console.log(`wifi-call listening on http://${HOST}:${PORT}`);
});

// Hosted platforms like Render already terminate TLS at the edge.
if (!process.env.RENDER && hasTlsMaterial()) {
  const tlsServer = https.createServer(
    {
      key: fs.readFileSync(path.join(CERT_DIR, "localhost-key.pem")),
      cert: fs.readFileSync(path.join(CERT_DIR, "localhost-cert.pem")),
    },
    requestHandler
  );

  tlsServer.listen(HTTPS_PORT, HOST, () => {
    console.log(`wifi-call listening on https://${HOST}:${HTTPS_PORT}`);
  });
} else if (!process.env.RENDER) {
  console.log("https disabled: add certs/localhost-key.pem and certs/localhost-cert.pem to enable it");
}
