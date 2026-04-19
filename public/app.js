const state = {
  room: "",
  clientId: "",
  stream: null,
  peerConnection: null,
  eventSource: null,
  remotePeerId: "",
  isMuted: false,
};

const nameInput = document.getElementById("name");
const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("joinBtn");
const micBtn = document.getElementById("micBtn");
const callBtn = document.getElementById("callBtn");
const hangupBtn = document.getElementById("hangupBtn");
const muteBtn = document.getElementById("muteBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const shareLinkInput = document.getElementById("shareLink");
const chatLog = document.getElementById("chatLog");
const historyLog = document.getElementById("historyLog");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const statusEl = document.getElementById("status");
const micStatusEl = document.getElementById("micStatus");
const peersEl = document.getElementById("peers");
const bannerEl = document.getElementById("presenceBanner");
const bannerTitleEl = document.getElementById("bannerTitle");
const bannerDetailEl = document.getElementById("bannerDetail");
const remoteAudio = document.getElementById("remoteAudio");
const diagServerEl = document.getElementById("diagServer");
const diagRoomEl = document.getElementById("diagRoom");
const diagMicEl = document.getElementById("diagMic");
const diagCallEl = document.getElementById("diagCall");

state.hasMicAccess = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function setPeers(text) {
  peersEl.textContent = text;
}

function setMicStatus(text) {
  micStatusEl.textContent = text;
}

function setDiagnostic(element, text) {
  element.textContent = text;
}

function setBanner(mode, title, detail) {
  bannerEl.className = `presence-banner ${mode}`;
  bannerTitleEl.textContent = title;
  bannerDetailEl.textContent = detail;
}

function updateButtons() {
  const joined = Boolean(state.eventSource);
  const onCall = Boolean(state.peerConnection);
  joinBtn.disabled = joined;
  callBtn.disabled = !joined || onCall || !state.remotePeerId || !state.hasMicAccess;
  hangupBtn.disabled = !onCall;
  muteBtn.disabled = !state.stream;
  micBtn.disabled = state.hasMicAccess;
  sendChatBtn.disabled = !joined;
  muteBtn.textContent = state.isMuted ? "Unmute" : "Mute";
}

function setCallDiagnostic(text) {
  setDiagnostic(diagCallEl, text);
}

async function checkServerHealth() {
  try {
    const response = await fetch("/health", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("bad health response");
    }
    setDiagnostic(diagServerEl, "Reachable");
  } catch {
    setDiagnostic(diagServerEl, "Unavailable");
  }
}

function createClientId(name) {
  return `${name}-${crypto.randomUUID().slice(0, 8)}`;
}

async function sendSignal(payload) {
  await fetch("/signal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room: state.room,
      from: state.clientId,
      ...payload,
    }),
  });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function createEntry(title, detail, timestamp) {
  const wrapper = document.createElement("div");
  wrapper.className = "entry";
  wrapper.innerHTML = `<strong>${title}</strong><div>${detail}</div><div>${formatTime(timestamp)}</div>`;
  return wrapper;
}

function renderCallLog(callLog = []) {
  historyLog.innerHTML = "";

  if (callLog.length === 0) {
    historyLog.append(createEntry("No calls yet", "Join a room and start one.", Date.now()));
    return;
  }

  [...callLog].reverse().forEach((entry) => {
    const title = entry.kind === "started" ? "Call started" : "Call ended";
    const detail = `${entry.from || "unknown"}${entry.to ? ` with ${entry.to}` : ""}`;
    historyLog.append(createEntry(title, detail, entry.createdAt));
  });
}

function appendChatMessage(author, text, timestamp) {
  if (chatLog.dataset.empty === "true") {
    chatLog.innerHTML = "";
    chatLog.dataset.empty = "false";
  }
  chatLog.prepend(createEntry(author, text, timestamp));
}

function renderEmptyChat() {
  chatLog.innerHTML = "";
  chatLog.dataset.empty = "true";
  chatLog.append(createEntry("No chat yet", "Messages in this room will show up here.", Date.now()));
}

async function loadHistory() {
  const response = await fetch(`/history?room=${encodeURIComponent(state.room)}`);
  const history = await response.json();
  renderCallLog(history.callLog || []);

  if (!history.messages || history.messages.length === 0) {
    renderEmptyChat();
    return;
  }

  chatLog.innerHTML = "";
  chatLog.dataset.empty = "false";
  history.messages
    .slice()
    .reverse()
    .forEach((message) => chatLog.append(createEntry(message.from, message.text, message.createdAt)));
}

function updateShareLink() {
  if (!state.room) {
    shareLinkInput.value = "";
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("room", state.room);
  shareLinkInput.value = url.toString();
}

async function ensureLocalAudio() {
  if (state.stream) {
    return state.stream;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    state.hasMicAccess = true;
    setMicStatus("Mic enabled and ready.");
    setDiagnostic(diagMicEl, "Enabled");
    updateButtons();
    return state.stream;
  } catch (error) {
    state.hasMicAccess = false;
    setMicStatus("Mic blocked. Allow microphone access in the browser, then press Enable Mic again.");
    setStatus("Microphone permission is required before calling.");
    setDiagnostic(diagMicEl, "Blocked");
    updateButtons();
    throw error;
  }
}

function createPeerConnection() {
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  connection.onicecandidate = (event) => {
    if (event.candidate && state.remotePeerId) {
      sendSignal({
        type: "ice-candidate",
        to: state.remotePeerId,
        candidate: event.candidate,
      });
    }
  };

  connection.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.volume = 1;
    remoteAudio
      .play()
      .then(() => {
        setCallDiagnostic("Audio playing");
      })
      .catch(() => {
        setCallDiagnostic("Playback blocked");
        setStatus("Call connected, but browser playback is blocked. Press play on the audio control.");
      });
    setStatus("Call connected.");
    setBanner("live", "Call is live", "You should hear the other side now.");
  };

  connection.onconnectionstatechange = () => {
    setCallDiagnostic(connection.connectionState || "Connecting");
    if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
      setStatus(`Call ${connection.connectionState}. Hang up and try again.`);
      setBanner("ready", "Peer is still here", "Try starting the call again.");
    }
  };

  connection.oniceconnectionstatechange = () => {
    if (connection.iceConnectionState === "failed") {
      setCallDiagnostic("ICE failed");
      setStatus("Network path failed. This often means these two devices need a TURN relay.");
    }
  };

  state.peerConnection = connection;
  updateButtons();
  return connection;
}

async function startPeerConnection() {
  const connection = createPeerConnection();
  const stream = await ensureLocalAudio();

  for (const track of stream.getTracks()) {
    connection.addTrack(track, stream);
  }

  return connection;
}

async function joinRoom() {
  const room = roomInput.value.trim().toLowerCase();
  const name = nameInput.value.trim().toLowerCase();

  if (!room || !name) {
    setStatus("Enter both your name and a room code.");
    return;
  }

  state.room = room;
  state.clientId = createClientId(name);
  updateShareLink();

  const eventSource = new EventSource(
    `/events?room=${encodeURIComponent(room)}&client=${encodeURIComponent(state.clientId)}`
  );
  state.eventSource = eventSource;

  eventSource.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    await handleSignal(message);
  };

  eventSource.onerror = () => {
    setStatus("Connection to room lost. Refresh and rejoin.");
    setBanner("waiting", "Room connection lost", "Refresh this page and join again.");
  };

  setStatus(`Joined room "${room}". Waiting for another person.`);
  setBanner("waiting", "Joined room", "Now open the same room somewhere else.");
  setDiagnostic(diagRoomEl, `Joined ${room}`);
  setCallDiagnostic("Idle");
  await loadHistory();
  updateButtons();
}

function refreshPeerState(peers) {
  const others = peers.filter((peer) => peer !== state.clientId);
  if (others.length > 0) {
    state.remotePeerId = others[0];
    setPeers(`Peer ready: ${others[0]}`);
    setStatus("Someone else joined your room.");
    setBanner("ready", "Someone joined your room", `${others[0]} is here. Enable your mic, then press Start Call.`);
    document.title = "Peer joined - Wi-Fi Call";
    setDiagnostic(diagRoomEl, "Peer joined");
  } else {
    state.remotePeerId = "";
    setPeers("No one else is here yet.");
    setBanner("waiting", "Waiting for someone else to join", "Open the same room in another tab or device.");
    document.title = "Wi-Fi Call";
    setDiagnostic(diagRoomEl, state.eventSource ? "Joined, waiting" : "Not joined");
  }
  updateButtons();
}

async function handleSignal(message) {
  if (message.type === "presence") {
    refreshPeerState(message.peers || []);
    renderCallLog(message.callLog || []);
    return;
  }

  if (message.to && message.to !== state.clientId) {
    return;
  }

  if (message.type === "offer") {
    state.remotePeerId = message.from;
    if (!state.hasMicAccess) {
      setStatus(`Incoming call from ${message.from}. Press Enable Mic, then ask them to call again.`);
      setBanner("calling", "Incoming call waiting", "Enable your mic first. The browser will ask for permission.");
      setCallDiagnostic("Waiting for mic");
      return;
    }
    const connection = await startPeerConnection();
    await connection.setRemoteDescription(message.offer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await sendSignal({
      type: "answer",
      to: message.from,
      answer,
    });
    setStatus(`Incoming call answered from ${message.from}.`);
    setBanner("calling", "Connecting call", `Answering ${message.from} now.`);
    setCallDiagnostic("Answering");
    return;
  }

  if (message.type === "answer" && state.peerConnection) {
    await state.peerConnection.setRemoteDescription(message.answer);
    setStatus("Call answered.");
    setBanner("calling", "Call answered", "Finishing connection now.");
    setCallDiagnostic("Negotiated");
    return;
  }

  if (message.type === "ice-candidate" && state.peerConnection && message.candidate) {
    await state.peerConnection.addIceCandidate(message.candidate);
    return;
  }

  if (message.type === "chat-message" && message.text) {
    appendChatMessage(message.from, message.text, message.createdAt);
    return;
  }

  if (message.type === "call-started") {
    await loadHistory();
    setBanner("calling", "Incoming call", `${message.from} is calling you now.`);
    setStatus(`Incoming call from ${message.from}.`);
    setCallDiagnostic("Incoming");
    return;
  }

  if (message.type === "hangup") {
    closeCall(false);
    setStatus("The other person hung up.");
    setBanner("ready", "Call ended", "The other person is still in the room.");
    setCallDiagnostic("Ended");
    await loadHistory();
  }
}

async function startCall() {
  if (!state.remotePeerId) {
    setStatus("No peer is available in the room.");
    return;
  }

  if (!state.hasMicAccess) {
    setStatus("Press Enable Mic first.");
    setBanner("calling", "Mic needed first", "Use Enable Mic, allow permission, then start the call.");
    setCallDiagnostic("Mic needed");
    return;
  }

  const connection = await startPeerConnection();
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  await sendSignal({
    type: "call-started",
    to: state.remotePeerId,
  });
  await sendSignal({
    type: "offer",
    to: state.remotePeerId,
    offer,
  });
  setStatus(`Calling ${state.remotePeerId}...`);
  setBanner("calling", "Calling now", `Trying to connect to ${state.remotePeerId}.`);
  setCallDiagnostic("Calling");
  await loadHistory();
}

function closeCall(notify = true) {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }

  remoteAudio.srcObject = null;
  remoteAudio.pause();
  updateButtons();

  if (notify && state.remotePeerId) {
    sendSignal({
      type: "hangup",
      to: state.remotePeerId,
    });
  }

  if (state.remotePeerId) {
    setBanner("ready", "Call ended", "The other person is still in the room.");
  } else {
    setBanner("waiting", "Waiting for someone else to join", "Open the same room in another tab or device.");
  }

  setCallDiagnostic("Idle");

  loadHistory();
}

function toggleMute() {
  if (!state.stream) {
    return;
  }

  state.isMuted = !state.isMuted;
  for (const track of state.stream.getAudioTracks()) {
    track.enabled = !state.isMuted;
  }
  updateButtons();
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) {
    return;
  }

  await sendSignal({
    type: "chat-message",
    text,
  });
  appendChatMessage(state.clientId, text, Date.now());
  chatInput.value = "";
}

async function copyLink() {
  if (!shareLinkInput.value) {
    return;
  }

  await navigator.clipboard.writeText(shareLinkInput.value);
  setStatus("Room link copied.");
}

async function enableMic() {
  try {
    await ensureLocalAudio();
    setStatus("Microphone is ready.");
    setCallDiagnostic("Ready");
    if (state.remotePeerId) {
      setBanner("ready", "Mic ready", "The other person is here. Press Start Call.");
    } else {
      setBanner("waiting", "Mic ready", "Now wait for someone else to join this room.");
    }
  } catch {
    // Status is already updated in ensureLocalAudio.
  }
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) {
    roomInput.value = room;
  }
}

joinBtn.addEventListener("click", joinRoom);
micBtn.addEventListener("click", enableMic);
callBtn.addEventListener("click", startCall);
hangupBtn.addEventListener("click", () => {
  closeCall(true);
  setStatus("Call ended.");
});
muteBtn.addEventListener("click", toggleMute);
sendChatBtn.addEventListener("click", sendChat);
copyLinkBtn.addEventListener("click", copyLink);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendChat();
  }
});

hydrateFromUrl();
renderEmptyChat();
renderCallLog();
setBanner("waiting", "Waiting for someone else to join", "Open the same room in another tab or device.");
checkServerHealth();
setCallDiagnostic("Idle");
updateButtons();
