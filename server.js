const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Map(),
      directory: new Map(),
      messages: [],
      callLog: [],
      nextMessageId: 1,
    });
  }

  return rooms.get(roomId);
}

function now() {
  return Date.now();
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
      if (body.length > 2_000_000) {
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

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);
}

function rosterSnapshot(room) {
  return Array.from(room.directory.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function writePresence(res, room) {
  res.write(
    `data: ${JSON.stringify({
      type: "presence",
      peers: rosterSnapshot(room),
      callLog: room.callLog,
    })}\n\n`
  );
}

function broadcastPresence(roomId) {
  const room = getRoom(roomId);
  const payload = {
    type: "presence",
    peers: rosterSnapshot(room),
    callLog: room.callLog,
  };
  broadcast(roomId, payload, { includeSender: true, persist: false });
}

function registerClient(roomId, clientId, name, status, res) {
  const room = getRoom(roomId);
  room.clients.set(clientId, { res, clientId, name, status, joinedAt: now() });
  room.directory.set(name, {
    clientId,
    name,
    status,
    online: true,
    lastSeen: now(),
  });
}

function markOffline(roomId, clientId) {
  const room = getRoom(roomId);
  const current = room.clients.get(clientId);
  if (current) {
    room.clients.delete(clientId);
    const entry = room.directory.get(current.name);
    if (entry) {
      room.directory.set(current.name, {
        ...entry,
        online: false,
        status: "offline",
        lastSeen: now(),
      });
    }
  }
}

function addCallLog(roomId, entry) {
  const room = getRoom(roomId);
  room.callLog.push({
    id: `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    createdAt: now(),
    ...entry,
  });
  if (room.callLog.length > 100) {
    room.callLog.shift();
  }
}

function broadcast(roomId, message, options = {}) {
  const room = getRoom(roomId);
  const event = {
    id: room.nextMessageId++,
    createdAt: now(),
    ...message,
  };

  if (options.persist !== false) {
    room.messages.push(event);
    if (room.messages.length > 500) {
      room.messages.shift();
    }
  }

  const payload = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const [clientId, client] of room.clients.entries()) {
    if (event.to && event.to !== clientId) {
      continue;
    }
    if (!options.includeSender && event.from && event.from === clientId) {
      continue;
    }
    client.res.write(payload);
  }
}

function handleEvents(req, res, url) {
  const roomId = url.searchParams.get("room");
  const clientId = url.searchParams.get("client");
  const name = normalizeName(url.searchParams.get("name"));
  const status = url.searchParams.get("status") || "online";

  if (!roomId || !clientId || !name) {
    sendJson(res, 400, { error: "room, client, and name are required" });
    return;
  }

  registerClient(roomId, clientId, name, status, res);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("\n");
  writePresence(res, getRoom(roomId));
  broadcastPresence(roomId);

  req.on("close", () => {
    markOffline(roomId, clientId);
    broadcastPresence(roomId);
  });
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
  const fromName = normalizeName(body.fromName);

  if (!roomId || !from || !body.type) {
    sendJson(res, 400, { error: "room, from, and type are required" });
    return;
  }

  if (body.type === "presence-update" && fromName) {
    const room = getRoom(roomId);
    const existing = room.directory.get(fromName);
    room.directory.set(fromName, {
      clientId: from,
      name: fromName,
      status: body.status || existing?.status || "online",
      online: true,
      lastSeen: now(),
    });
    broadcastPresence(roomId);
    sendJson(res, 202, { ok: true });
    return;
  }

  if (body.type === "call-started") {
    addCallLog(roomId, {
      kind: "started",
      fromName: fromName || body.fromName || from,
      toName: body.toName || null,
    });
  }

  if (body.type === "hangup") {
    addCallLog(roomId, {
      kind: "ended",
      fromName: fromName || body.fromName || from,
      toName: body.toName || null,
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
    peers: rosterSnapshot(room),
    messages: room.messages.filter((message) =>
      ["chat-message", "file-meta", "chat-read"].includes(message.type)
    ),
  });
}

function handleConfig(res) {
  const turnUrls = process.env.TURN_URLS ? process.env.TURN_URLS.split(",").map((item) => item.trim()) : [];
  sendJson(res, 200, {
    turn: {
      enabled: turnUrls.length > 0,
      urls: turnUrls,
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    },
    hooks: {
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ? "configured" : "",
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
      firebaseApiKey: process.env.FIREBASE_API_KEY ? "configured" : "",
      onesignalAppId: process.env.ONESIGNAL_APP_ID || "",
      cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    },
    features: {
      authMode: process.env.SUPABASE_URL ? "supabase-ready" : process.env.FIREBASE_PROJECT_ID ? "firebase-ready" : "local",
      pushMode: process.env.ONESIGNAL_APP_ID ? "onesignal-ready" : "browser-only",
      storageMode: process.env.CLOUDINARY_CLOUD_NAME ? "cloudinary-ready" : "p2p-only",
    },
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

  if (req.method === "GET" && url.pathname === "/config") {
    handleConfig(res);
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
}
