const state = {
  roomId: "",
  roomKey: "",
  selfName: "",
  clientId: "",
  peers: [],
  selectedPeerId: "",
  selectedPeerName: "",
  eventSource: null,
  reconnectTimer: null,
  reconnectAllowed: false,
  config: null,
  localStream: null,
  remoteStream: new MediaStream(),
  peerConnection: null,
  dataChannel: null,
  pendingOffer: null,
  hasMicAccess: false,
  isMuted: false,
  isCameraOn: false,
  isScreenSharing: false,
  pushToTalk: false,
  messages: [],
  contacts: [],
  callLog: [],
  typingPeer: "",
  mediaRecorder: null,
  recordChunks: [],
  statsTimer: null,
  localVoiceTimer: null,
  localAnalyser: null,
  localAudioContext: null,
  currentStatus: "offline",
  notifyPermission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  accountMode: "local",
};

const els = {
  name: document.getElementById("name"),
  passcode: document.getElementById("passcode"),
  targetName: document.getElementById("targetName"),
  shareLink: document.getElementById("shareLink"),
  joinBtn: document.getElementById("joinBtn"),
  micBtn: document.getElementById("micBtn"),
  cameraBtn: document.getElementById("cameraBtn"),
  screenBtn: document.getElementById("screenBtn"),
  callBtn: document.getElementById("callBtn"),
  answerBtn: document.getElementById("answerBtn"),
  declineBtn: document.getElementById("declineBtn"),
  hangupBtn: document.getElementById("hangupBtn"),
  muteBtn: document.getElementById("muteBtn"),
  pttBtn: document.getElementById("pttBtn"),
  recordBtn: document.getElementById("recordBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  echoToggle: document.getElementById("echoToggle"),
  noiseToggle: document.getElementById("noiseToggle"),
  videoToggle: document.getElementById("videoToggle"),
  status: document.getElementById("status"),
  micStatus: document.getElementById("micStatus"),
  peers: document.getElementById("peers"),
  typingStatus: document.getElementById("typingStatus"),
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
  remoteAudio: document.getElementById("remoteAudio"),
  presenceBanner: document.getElementById("presenceBanner"),
  bannerTitle: document.getElementById("bannerTitle"),
  bannerDetail: document.getElementById("bannerDetail"),
  diagServer: document.getElementById("diagServer"),
  diagRoom: document.getElementById("diagRoom"),
  diagMic: document.getElementById("diagMic"),
  diagCall: document.getElementById("diagCall"),
  diagIce: document.getElementById("diagIce"),
  diagMedia: document.getElementById("diagMedia"),
  diagStats: document.getElementById("diagStats"),
  diagTurn: document.getElementById("diagTurn"),
  diagVoice: document.getElementById("diagVoice"),
  presenceList: document.getElementById("presenceList"),
  contactsList: document.getElementById("contactsList"),
  chatLog: document.getElementById("chatLog"),
  filesLog: document.getElementById("filesLog"),
  historyLog: document.getElementById("historyLog"),
  chatInput: document.getElementById("chatInput"),
  sendChatBtn: document.getElementById("sendChatBtn"),
  fileInput: document.getElementById("fileInput"),
  sendFileBtn: document.getElementById("sendFileBtn"),
  contactNameInput: document.getElementById("contactNameInput"),
  saveContactBtn: document.getElementById("saveContactBtn"),
  incomingDialog: document.getElementById("incomingDialog"),
  incomingText: document.getElementById("incomingText"),
  dialogAnswerBtn: document.getElementById("dialogAnswerBtn"),
  dialogDeclineBtn: document.getElementById("dialogDeclineBtn"),
};

function setText(node, text) {
  node.textContent = text;
}

function setBanner(mode, title, detail) {
  els.presenceBanner.className = `presence-banner ${mode}`;
  setText(els.bannerTitle, title);
  setText(els.bannerDetail, detail);
}

function setStatus(text) {
  setText(els.status, text);
}

function setTypingStatus(text) {
  setText(els.typingStatus, text);
}

function setDiag(key, text) {
  setText(els[key], text);
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);
}

function getSelectedPeer() {
  return state.peers.find((peer) => peer.clientId === state.selectedPeerId) || null;
}

function isInCall() {
  return Boolean(state.peerConnection);
}

function loadContacts() {
  try {
    state.contacts = JSON.parse(localStorage.getItem("wifi-call-contacts") || "[]");
  } catch {
    state.contacts = [];
  }
}

function saveContacts() {
  localStorage.setItem("wifi-call-contacts", JSON.stringify(state.contacts));
}

function upsertContact(name) {
  const normalized = normalizeName(name);
  if (!normalized) {
    return;
  }

  const existing = state.contacts.find((item) => item.name === normalized);
  const stamp = new Date().toISOString();

  if (existing) {
    existing.lastUsed = stamp;
  } else {
    state.contacts.unshift({ name: normalized, lastUsed: stamp });
  }

  state.contacts = state.contacts.slice(0, 20);
  saveContacts();
  renderContacts();
}

function createEntry(title, detail, meta = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "entry";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const detailNode = document.createElement("div");
  detailNode.textContent = detail;
  wrapper.append(strong, detailNode);
  if (meta) {
    const metaNode = document.createElement("div");
    metaNode.textContent = meta;
    wrapper.append(metaNode);
  }
  return wrapper;
}

function lastSeenText(timestamp) {
  if (!timestamp) {
    return "last seen unknown";
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}

function renderPresence() {
  els.presenceList.innerHTML = "";
  const peers = state.peers.filter((peer) => peer.name !== state.selfName);

  if (peers.length === 0) {
    els.presenceList.append(createEntry("No one else is here", "Share a call link or ask someone to join.", ""));
    return;
  }

  for (const peer of peers) {
    const item = document.createElement("div");
    item.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = peer.name;
    const meta = document.createElement("div");
    meta.textContent = peer.online
      ? `${peer.status || "online"} now`
      : `offline, ${lastSeenText(peer.lastSeen)}`;
    const buttonRow = document.createElement("div");
    buttonRow.className = "actions";
    const selectBtn = document.createElement("button");
    selectBtn.textContent = "Select";
    selectBtn.addEventListener("click", () => selectPeer(peer));
    const callBtn = document.createElement("button");
    callBtn.textContent = "Call";
    callBtn.disabled = !peer.online || !state.hasMicAccess;
    callBtn.addEventListener("click", () => {
      selectPeer(peer);
      startCall();
    });
    buttonRow.append(selectBtn, callBtn);
    item.append(title, meta, buttonRow);
    els.presenceList.append(item);
  }
}

function renderContacts() {
  els.contactsList.innerHTML = "";

  if (state.contacts.length === 0) {
    els.contactsList.append(createEntry("No contacts yet", "Save usernames here for quick calling."));
    return;
  }

  for (const contact of state.contacts) {
    const item = document.createElement("div");
    item.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = contact.name;
    const meta = document.createElement("div");
    meta.textContent = `saved ${new Date(contact.lastUsed).toLocaleString()}`;
    const row = document.createElement("div");
    row.className = "actions";
    const choose = document.createElement("button");
    choose.textContent = "Choose";
    choose.addEventListener("click", () => {
      const peer = state.peers.find((itemPeer) => itemPeer.name === contact.name);
      selectPeer(peer || { clientId: "", name: contact.name });
    });
    row.append(choose);
    item.append(title, meta, row);
    els.contactsList.append(item);
  }
}

function renderHistory() {
  els.historyLog.innerHTML = "";
  if (state.callLog.length === 0) {
    els.historyLog.append(createEntry("No calls yet", "Call history appears here."));
    return;
  }

  for (const entry of [...state.callLog].reverse()) {
    const title = entry.kind === "started" ? "Call started" : "Call ended";
    const detail = `${entry.fromName || "unknown"}${entry.toName ? ` -> ${entry.toName}` : ""}`;
    els.historyLog.append(
      createEntry(title, detail, new Date(entry.createdAt).toLocaleTimeString())
    );
  }
}

function renderFilesLog(message, incoming = false) {
  const title = incoming ? `File from ${message.fromName}` : `Sent ${message.name}`;
  const item = document.createElement("div");
  item.className = "list-item";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const meta = document.createElement("div");
  meta.textContent = `${message.name} • ${Math.round((message.size || 0) / 1024)} KB`;
  item.append(heading, meta);

  if (message.dataUrl) {
    const link = document.createElement("a");
    link.href = message.dataUrl;
    link.download = message.name;
    link.textContent = "Download";
    item.append(link);
  }

  els.filesLog.prepend(item);
}

function currentPeerName() {
  return normalizeName(els.targetName.value) || state.selectedPeerName;
}

function renderChat() {
  els.chatLog.innerHTML = "";
  const target = currentPeerName();
  const relevant = state.messages.filter(
    (message) =>
      !target ||
      message.fromName === target ||
      message.toName === target ||
      message.fromName === state.selfName
  );

  if (relevant.length === 0) {
    els.chatLog.append(createEntry("No messages yet", "Chat with your selected username."));
    return;
  }

  for (const message of relevant.slice().reverse()) {
    const receipt = message.readAt ? "Read" : message.fromName === state.selfName ? "Sent" : "Delivered";
    els.chatLog.append(
      createEntry(
        message.fromName,
        message.text,
        `${new Date(message.createdAt || Date.now()).toLocaleTimeString()} • ${receipt}`
      )
    );
  }
}

function updateShareLink() {
  const url = new URL(window.location.href);
  if (state.selfName) {
    url.searchParams.set("user", state.selfName);
  }
  if (state.roomKey) {
    url.searchParams.set("key", state.roomKey);
  }
  const target = currentPeerName();
  if (target) {
    url.searchParams.set("target", target);
  } else {
    url.searchParams.delete("target");
  }
  els.shareLink.value = url.toString();
}

function updateButtons() {
  const joined = Boolean(state.eventSource);
  const selected = Boolean(currentPeerName());
  const callActive = isInCall();
  const pending = Boolean(state.pendingOffer);

  els.joinBtn.disabled = joined;
  els.callBtn.disabled = !joined || !selected || !state.hasMicAccess || callActive;
  els.answerBtn.disabled = !pending;
  els.declineBtn.disabled = !pending;
  els.hangupBtn.disabled = !callActive;
  els.muteBtn.disabled = !state.localStream;
  els.pttBtn.disabled = !state.localStream;
  els.recordBtn.disabled = !callActive || !state.remoteStream.getTracks().length;
  els.sendChatBtn.disabled = !joined || !selected;
  els.sendFileBtn.disabled = !callActive || !state.dataChannel || state.dataChannel.readyState !== "open";
  els.micBtn.disabled = state.hasMicAccess;
  els.muteBtn.textContent = state.isMuted ? "Unmute" : "Mute";
  els.cameraBtn.textContent = state.isCameraOn ? "Camera Off" : "Camera";
  els.screenBtn.textContent = state.isScreenSharing ? "Stop Share" : "Share Screen";
  els.recordBtn.textContent = state.mediaRecorder ? "Stop Recording" : "Record";
  els.pttBtn.textContent = state.pushToTalk ? "Push To Talk On" : "Push To Talk Off";
  updateShareLink();
}

function maybeNotify(title, body) {
  if (typeof Notification === "undefined") {
    return;
  }
  if (state.notifyPermission !== "granted") {
    return;
  }
  if (document.visibilityState === "visible") {
    return;
  }
  new Notification(title, { body });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function checkHealth() {
  try {
    await fetchJson("/health");
    setDiag("diagServer", "Reachable");
  } catch {
    setDiag("diagServer", "Unavailable");
  }
}

async function loadConfig() {
  try {
    state.config = await fetchJson("/config");
    state.accountMode = state.config.features?.authMode || "local";
    if (state.config.turn?.urls?.length) {
      setDiag("diagTurn", "Configured");
    } else {
      setDiag("diagTurn", "STUN only");
    }
    if (state.accountMode !== "local") {
      setStatus(`Joined in ${state.accountMode} mode when you connect provider keys.`);
    }
  } catch {
    setDiag("diagTurn", "Unavailable");
  }
}

async function hashRoomKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { roomId: "public-lobby", key: "" };
  }

  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
  return { roomId: `key-${hex.slice(0, 16)}`, key: raw };
}

function makeIceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const turn = state.config?.turn;
  if (turn?.urls?.length) {
    servers.push({
      urls: turn.urls,
      username: turn.username,
      credential: turn.credential,
    });
  }
  return servers;
}

function selectPeer(peer) {
  state.selectedPeerId = peer.clientId || "";
  state.selectedPeerName = normalizeName(peer.name);
  els.targetName.value = state.selectedPeerName;
  setText(els.peers, state.selectedPeerName ? `Selected ${state.selectedPeerName}` : "No peer selected.");
  upsertContact(state.selectedPeerName);
  updateButtons();
  renderChat();
}

function buildClientId() {
  return `${state.selfName}-${crypto.randomUUID().slice(0, 8)}`;
}

async function sendSignal(payload) {
  await fetch("/signal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      room: state.roomId,
      from: state.clientId,
      fromName: state.selfName,
      ...payload,
    }),
  });
}

async function sendPresenceStatus(status) {
  state.currentStatus = status;
  if (!state.eventSource) {
    return;
  }
  await sendSignal({
    type: "presence-update",
    status,
  });
}

async function ensureAudio() {
  if (state.localStream?.getAudioTracks().length) {
    return state.localStream;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: els.echoToggle.checked,
      noiseSuppression: els.noiseToggle.checked,
    },
    video: false,
  });

  state.localStream = state.localStream || new MediaStream();
  stream.getAudioTracks().forEach((track) => state.localStream.addTrack(track));
  els.localVideo.srcObject = state.localStream;
  state.hasMicAccess = true;
  setText(els.micStatus, "Mic enabled and ready.");
  setDiag("diagMic", "Enabled");
  attachVoiceMonitor();
  updateButtons();
  return state.localStream;
}

async function toggleCamera() {
  if (!state.hasMicAccess) {
    await ensureAudio();
  }

  if (state.isCameraOn) {
    const videoTrack = state.localStream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.stop();
      state.localStream.removeTrack(videoTrack);
      const sender = state.peerConnection?.getSenders().find((item) => item.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(null);
      }
    }
    state.isCameraOn = false;
    setDiag("diagMedia", state.isScreenSharing ? "Screen share" : "Audio only");
    els.localVideo.srcObject = state.localStream;
    updateButtons();
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  const track = stream.getVideoTracks()[0];
  state.localStream = state.localStream || new MediaStream();
  state.localStream.addTrack(track);
  els.localVideo.srcObject = state.localStream;
  state.isCameraOn = true;
  setDiag("diagMedia", "Audio + camera");
  const sender = state.peerConnection?.getSenders().find((item) => item.track?.kind === "video");
  if (sender) {
    await sender.replaceTrack(track);
  } else if (state.peerConnection) {
    state.peerConnection.addTrack(track, state.localStream);
  }
  updateButtons();
}

async function toggleScreenShare() {
  if (state.isScreenSharing) {
    const sender = state.peerConnection?.getSenders().find((item) => item.track?.kind === "video");
    const cameraTrack = state.localStream?.getVideoTracks()[0] || null;
    if (sender) {
      await sender.replaceTrack(cameraTrack);
    }
    state.isScreenSharing = false;
    setDiag("diagMedia", state.isCameraOn ? "Audio + camera" : "Audio only");
    updateButtons();
    return;
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const track = stream.getVideoTracks()[0];
  track.addEventListener("ended", () => {
    if (state.isScreenSharing) {
      toggleScreenShare().catch(() => {});
    }
  });
  const sender = state.peerConnection?.getSenders().find((item) => item.track?.kind === "video");
  if (sender) {
    await sender.replaceTrack(track);
  } else if (state.peerConnection) {
    state.peerConnection.addTrack(track, stream);
  }
  els.localVideo.srcObject = stream;
  state.isScreenSharing = true;
  setDiag("diagMedia", "Screen share");
  updateButtons();
}

function attachVoiceMonitor() {
  if (!state.localStream || state.localAnalyser) {
    return;
  }

  state.localAudioContext = new AudioContext();
  const source = state.localAudioContext.createMediaStreamSource(state.localStream);
  state.localAnalyser = state.localAudioContext.createAnalyser();
  state.localAnalyser.fftSize = 256;
  source.connect(state.localAnalyser);

  const data = new Uint8Array(state.localAnalyser.frequencyBinCount);
  state.localVoiceTimer = window.setInterval(() => {
    state.localAnalyser.getByteFrequencyData(data);
    const avg = data.reduce((total, value) => total + value, 0) / data.length;
    setDiag("diagVoice", avg > 18 ? "Speaking" : "Silent");
  }, 500);
}

function createPeerConnection(isCaller) {
  const connection = new RTCPeerConnection({
    iceServers: makeIceServers(),
  });

  state.remoteStream = new MediaStream();
  els.remoteVideo.srcObject = state.remoteStream;
  els.remoteAudio.srcObject = state.remoteStream;

  connection.onicecandidate = (event) => {
    if (event.candidate && state.selectedPeerId) {
      sendSignal({
        type: "ice-candidate",
        to: state.selectedPeerId,
        toName: currentPeerName(),
        candidate: event.candidate,
      }).catch(() => {});
    }
  };

  connection.ontrack = (event) => {
    state.remoteStream.addTrack(event.track);
    els.remoteAudio
      .play()
      .then(() => setDiag("diagCall", "Audio playing"))
      .catch(() => setDiag("diagCall", "Press play"));
  };

  connection.onconnectionstatechange = () => {
    setDiag("diagCall", connection.connectionState || "connecting");
    if (connection.connectionState === "connected") {
      setBanner("live", "Call is live", `Talking with ${currentPeerName()}.`);
      setStatus("Call connected.");
      sendPresenceStatus("in-call").catch(() => {});
      startStatsPolling();
    }
    if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
      setStatus(`Call ${connection.connectionState}.`);
    }
  };

  connection.oniceconnectionstatechange = () => {
    setDiag("diagIce", connection.iceConnectionState || "idle");
  };

  if (isCaller) {
    const dataChannel = connection.createDataChannel("chat-data");
    setupDataChannel(dataChannel);
  } else {
    connection.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };
  }

  state.peerConnection = connection;
  addLocalTracksToConnection();
  updateButtons();
  return connection;
}

function addLocalTracksToConnection() {
  if (!state.peerConnection || !state.localStream) {
    return;
  }

  const existingKinds = new Set(state.peerConnection.getSenders().map((sender) => sender.track?.kind));
  for (const track of state.localStream.getTracks()) {
    if (!existingKinds.has(track.kind)) {
      state.peerConnection.addTrack(track, state.localStream);
    }
  }
}

function setupDataChannel(channel) {
  state.dataChannel = channel;
  channel.onopen = () => {
    setDiag("diagCall", "Data channel open");
    updateButtons();
  };
  channel.onclose = () => updateButtons();
  channel.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "file") {
        renderFilesLog(payload, true);
      }
    } catch {
      // Ignore malformed payloads.
    }
  };
}

function playRingtone() {
  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 720;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      audioContext.close();
    }, 650);
  } catch {
    // Ringtone is best effort only.
  }
}

async function startCall() {
  const targetName = currentPeerName();
  const peer = state.peers.find((item) => item.name === targetName && item.online);
  if (!peer) {
    setStatus("That username is not online in this room key.");
    setBanner("ready", "Unavailable", "That person is offline or not in this room.");
    setDiag("diagCall", "Unavailable");
    return;
  }

  if (peer.status === "in-call") {
    setStatus(`${peer.name} is already in a call.`);
    setBanner("ready", "Busy", "Try again when they are available.");
    setDiag("diagCall", "Busy");
    return;
  }

  selectPeer(peer);
  upsertContact(peer.name);
  await ensureAudio();
  if (els.videoToggle.checked && !state.isCameraOn) {
    await toggleCamera();
  }

  const connection = createPeerConnection(true);
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);

  await sendSignal({
    type: "call-started",
    to: peer.clientId,
    toName: peer.name,
  });

  await sendSignal({
    type: "offer",
    to: peer.clientId,
    toName: peer.name,
    offer,
    wantsVideo: state.isCameraOn || els.videoToggle.checked,
  });

  setBanner("calling", "Calling now", `Calling ${peer.name}.`);
  setStatus(`Calling ${peer.name}...`);
  setDiag("diagCall", "Calling");
}

async function answerCall() {
  if (!state.pendingOffer) {
    return;
  }

  await ensureAudio();
  if (state.pendingOffer.wantsVideo && els.videoToggle.checked && !state.isCameraOn) {
    await toggleCamera();
  }

  const connection = createPeerConnection(false);
  await connection.setRemoteDescription(state.pendingOffer.offer);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);

  await sendSignal({
    type: "answer",
    to: state.pendingOffer.from,
    toName: state.pendingOffer.fromName,
    answer,
  });

  els.incomingDialog.close();
  state.pendingOffer = null;
  setBanner("calling", "Connecting call", `Answering ${currentPeerName()}.`);
  setDiag("diagCall", "Answering");
  updateButtons();
}

async function declineCall() {
  if (!state.pendingOffer) {
    return;
  }

  await sendSignal({
    type: "call-declined",
    to: state.pendingOffer.from,
    toName: state.pendingOffer.fromName,
  });

  els.incomingDialog.close();
  state.pendingOffer = null;
  setStatus("Declined the incoming call.");
  setBanner("ready", "Call declined", "The caller is still online.");
  updateButtons();
}

async function handleSignal(message) {
  if (message.type === "presence") {
    state.peers = message.peers || [];
    state.callLog = message.callLog || [];
    renderPresence();
    renderHistory();

    const match = state.peers.find((peer) => peer.name === currentPeerName());
    if (match) {
      state.selectedPeerId = match.clientId;
      state.selectedPeerName = match.name;
      setText(els.peers, `Selected ${match.name}`);
    }
    updateButtons();
    return;
  }

  if (message.to && message.to !== state.clientId) {
    return;
  }

  if (message.type === "offer") {
    if (state.pendingOffer || isInCall()) {
      await sendSignal({
        type: "call-busy",
        to: message.from,
        toName: message.fromName,
      });
      return;
    }
    state.selectedPeerId = message.from;
    state.selectedPeerName = message.fromName;
    els.targetName.value = message.fromName;
    state.pendingOffer = message;
    els.incomingText.textContent = `${message.fromName} is calling you.`;
    if (!els.incomingDialog.open) {
      els.incomingDialog.showModal();
    }
    playRingtone();
    maybeNotify("Incoming Wi-Fi Call", `${message.fromName} is calling you.`);
    setBanner("calling", "Incoming call", `Answer or decline ${message.fromName}.`);
    setStatus(`Incoming call from ${message.fromName}.`);
    setDiag("diagCall", "Incoming");
    updateButtons();
    return;
  }

  if (message.type === "answer" && state.peerConnection) {
    await state.peerConnection.setRemoteDescription(message.answer);
    setStatus("Call answered.");
    setDiag("diagCall", "Negotiated");
    return;
  }

  if (message.type === "ice-candidate" && state.peerConnection && message.candidate) {
    await state.peerConnection.addIceCandidate(message.candidate);
    return;
  }

  if (message.type === "call-declined") {
    setStatus(`${message.fromName} declined the call.`);
    setBanner("ready", "Call declined", "You can try again later.");
    setDiag("diagCall", "Declined");
    closeCall(false);
    return;
  }

  if (message.type === "call-busy") {
    setStatus(`${message.fromName} is busy.`);
    setBanner("ready", "Busy", "The other person is already on a call.");
    setDiag("diagCall", "Busy");
    closeCall(false);
    return;
  }

  if (message.type === "hangup") {
    setStatus(`${message.fromName} hung up.`);
    closeCall(false);
    return;
  }

  if (message.type === "typing") {
    setTypingStatus(`${message.fromName} is typing...`);
    window.clearTimeout(state.typingTimer);
    state.typingTimer = window.setTimeout(() => setTypingStatus("No one is typing."), 1200);
    return;
  }

  if (message.type === "chat-message") {
    state.messages.push({ ...message, readAt: null });
    renderChat();
    maybeNotify(`Message from ${message.fromName}`, message.text);
    await sendSignal({
      type: "chat-read",
      to: message.from,
      toName: message.fromName,
      messageId: message.messageId,
    });
    return;
  }

  if (message.type === "chat-read") {
    const local = state.messages.find((item) => item.messageId === message.messageId);
    if (local) {
      local.readAt = Date.now();
      renderChat();
    }
  }
}

async function loadHistory() {
  if (!state.roomId) {
    return;
  }

  const history = await fetchJson(`/history?room=${encodeURIComponent(state.roomId)}`);
  state.callLog = history.callLog || [];
  state.messages = history.messages || [];
  state.peers = history.peers || state.peers;
  renderHistory();
  renderPresence();
  renderChat();
}

async function joinRoom() {
  const selfName = normalizeName(els.name.value);
  if (!selfName) {
    setStatus("Pick a username first.");
    return;
  }

  const roomInfo = await hashRoomKey(els.passcode.value);
  state.roomId = roomInfo.roomId;
  state.roomKey = roomInfo.key;
  state.selfName = selfName;
  state.clientId = buildClientId();
  state.reconnectAllowed = true;

  setDiag("diagRoom", roomInfo.key ? "Private key room" : "Public lobby");
  setStatus("Joining...");
  setBanner("waiting", "Joining room", "Opening realtime presence now.");

  connectEventStream();
  upsertContact(selfName);
  localStorage.setItem("wifi-call-last-user", selfName);
}

function connectEventStream() {
  if (!state.roomId || !state.selfName || !state.clientId) {
    return;
  }

  state.eventSource?.close();
  const url = `/events?room=${encodeURIComponent(state.roomId)}&client=${encodeURIComponent(
    state.clientId
  )}&name=${encodeURIComponent(state.selfName)}&status=${encodeURIComponent(state.currentStatus || "online")}`;
  const eventSource = new EventSource(url);
  state.eventSource = eventSource;

  eventSource.onmessage = async (event) => {
    const payload = JSON.parse(event.data);
    await handleSignal(payload);
  };

  eventSource.onerror = () => {
    setStatus("Connection lost. Reconnecting...");
    setBanner("waiting", "Reconnecting", "Trying to restore presence and call state.");
    setDiag("diagRoom", "Reconnecting");
    eventSource.close();
    state.eventSource = null;

    if (state.reconnectAllowed) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = window.setTimeout(connectEventStream, 2000);
    }
  };

  setStatus(`Joined as ${state.selfName}.`);
  setBanner(
    "waiting",
    "Joined",
    state.accountMode === "local"
      ? "Local account mode. Select a username from the people list or use a call link."
      : `Connected in ${state.accountMode}. Select a username from the people list or use a call link.`
  );
  setDiag("diagRoom", "Joined");
  loadHistory().catch(() => {});
  sendPresenceStatus("online").catch(() => {});
  updateButtons();
}

function closeCall(notify = true) {
  if (notify && state.selectedPeerId) {
    sendSignal({
      type: "hangup",
      to: state.selectedPeerId,
      toName: currentPeerName(),
    }).catch(() => {});
  }

  window.clearInterval(state.statsTimer);
  state.statsTimer = null;
  state.peerConnection?.close();
  state.peerConnection = null;
  state.dataChannel = null;
  state.remoteStream = new MediaStream();
  els.remoteVideo.srcObject = state.remoteStream;
  els.remoteAudio.srcObject = state.remoteStream;
  setDiag("diagCall", "Idle");
  setDiag("diagIce", "Idle");
  setDiag("diagStats", "No active call");
  setBanner("ready", "Call ended", "The other person may still be online.");
  sendPresenceStatus("online").catch(() => {});
  updateButtons();
}

function toggleMute() {
  if (!state.localStream) {
    return;
  }

  state.isMuted = !state.isMuted;
  state.localStream.getAudioTracks().forEach((track) => {
    track.enabled = !state.isMuted;
  });
  updateButtons();
}

function togglePushToTalkMode() {
  state.pushToTalk = !state.pushToTalk;
  if (!state.localStream) {
    updateButtons();
    return;
  }

  const enabled = !state.pushToTalk && !state.isMuted;
  state.localStream.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
  updateButtons();
}

function setPushToTalkPressed(active) {
  if (!state.pushToTalk || !state.localStream) {
    return;
  }
  state.localStream.getAudioTracks().forEach((track) => {
    track.enabled = active;
  });
}

async function sendChat() {
  const target = currentPeerName();
  const peer = state.peers.find((item) => item.name === target);
  const text = els.chatInput.value.trim();
  if (!text || !peer) {
    return;
  }

  const messageId = crypto.randomUUID();
  const message = {
    type: "chat-message",
    to: peer.clientId,
    toName: peer.name,
    text,
    messageId,
    createdAt: Date.now(),
    fromName: state.selfName,
  };

  state.messages.push({ ...message });
  renderChat();
  els.chatInput.value = "";
  await sendSignal(message);
}

async function sendTyping() {
  const target = currentPeerName();
  const peer = state.peers.find((item) => item.name === target);
  if (!peer) {
    return;
  }

  await sendSignal({
    type: "typing",
    to: peer.clientId,
    toName: peer.name,
  });
}

async function sendFile() {
  const file = els.fileInput.files[0];
  if (!file || !state.dataChannel || state.dataChannel.readyState !== "open") {
    return;
  }

  if (file.size > 750_000) {
    setStatus("Keep file transfers under about 750 KB for this free browser-only version.");
    return;
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const payload = {
    type: "file",
    fromName: state.selfName,
    name: file.name,
    size: file.size,
    mime: file.type,
    dataUrl,
  };

  state.dataChannel.send(JSON.stringify(payload));
  renderFilesLog(payload, false);
  await sendSignal({
    type: "file-meta",
    to: state.selectedPeerId,
    toName: currentPeerName(),
    name: file.name,
    size: file.size,
  });
  els.fileInput.value = "";
}

function toggleRecording() {
  if (state.mediaRecorder) {
    state.mediaRecorder.stop();
    return;
  }

  const stream = state.remoteStream.getTracks().length ? state.remoteStream : state.localStream;
  if (!stream) {
    return;
  }

  state.recordChunks = [];
  state.mediaRecorder = new MediaRecorder(stream);
  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data.size) {
      state.recordChunks.push(event.data);
    }
  };
  state.mediaRecorder.onstop = () => {
    const blob = new Blob(state.recordChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wifi-call-${Date.now()}.webm`;
    link.click();
    URL.revokeObjectURL(url);
    state.mediaRecorder = null;
    updateButtons();
  };
  state.mediaRecorder.start();
  updateButtons();
}

function startStatsPolling() {
  window.clearInterval(state.statsTimer);
  state.statsTimer = window.setInterval(async () => {
    if (!state.peerConnection) {
      return;
    }

    const stats = await state.peerConnection.getStats();
    let line = "No RTP yet";
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        line = `RTT ${Math.round((report.currentRoundTripTime || 0) * 1000)}ms`;
      }
      if (report.type === "inbound-rtp" && report.kind === "audio") {
        line = `Packets ${report.packetsReceived || 0} • Lost ${report.packetsLost || 0}`;
      }
    });
    setDiag("diagStats", line);
  }, 2000);
}

async function copyLink() {
  if (!els.shareLink.value) {
    return;
  }

  await navigator.clipboard.writeText(els.shareLink.value);
  setStatus("Call link copied.");
}

function saveContactFromInput() {
  upsertContact(els.contactNameInput.value);
  els.contactNameInput.value = "";
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const savedUser = normalizeName(localStorage.getItem("wifi-call-last-user"));
  const user = normalizeName(params.get("user"));
  const target = normalizeName(params.get("target"));
  const key = params.get("key") || "";
  if (user || savedUser) {
    els.name.value = user || savedUser;
  }
  if (target) {
    els.targetName.value = target;
    state.selectedPeerName = target;
  }
  if (key) {
    els.passcode.value = key;
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }
}

async function requestNotificationPermission() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") {
    state.notifyPermission = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    return;
  }
  try {
    state.notifyPermission = await Notification.requestPermission();
  } catch {
    state.notifyPermission = "denied";
  }
}

els.joinBtn.addEventListener("click", () => joinRoom().catch((error) => setStatus(error.message)));
els.micBtn.addEventListener("click", () => ensureAudio().catch((error) => setStatus(error.message)));
els.cameraBtn.addEventListener("click", () => toggleCamera().catch((error) => setStatus(error.message)));
els.screenBtn.addEventListener("click", () => toggleScreenShare().catch((error) => setStatus(error.message)));
els.callBtn.addEventListener("click", () => startCall().catch((error) => setStatus(error.message)));
els.answerBtn.addEventListener("click", () => answerCall().catch((error) => setStatus(error.message)));
els.declineBtn.addEventListener("click", () => declineCall().catch((error) => setStatus(error.message)));
els.dialogAnswerBtn.addEventListener("click", () => answerCall().catch((error) => setStatus(error.message)));
els.dialogDeclineBtn.addEventListener("click", () => declineCall().catch((error) => setStatus(error.message)));
els.hangupBtn.addEventListener("click", () => closeCall(true));
els.muteBtn.addEventListener("click", toggleMute);
els.pttBtn.addEventListener("click", togglePushToTalkMode);
els.recordBtn.addEventListener("click", toggleRecording);
els.copyLinkBtn.addEventListener("click", () => copyLink().catch((error) => setStatus(error.message)));
els.sendChatBtn.addEventListener("click", () => sendChat().catch((error) => setStatus(error.message)));
els.sendFileBtn.addEventListener("click", () => sendFile().catch((error) => setStatus(error.message)));
els.saveContactBtn.addEventListener("click", saveContactFromInput);
els.targetName.addEventListener("input", () => {
  state.selectedPeerName = normalizeName(els.targetName.value);
  updateButtons();
  renderChat();
});
els.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendChat().catch((error) => setStatus(error.message));
  } else {
    sendTyping().catch(() => {});
  }
});
els.pttBtn.addEventListener("mousedown", () => setPushToTalkPressed(true));
els.pttBtn.addEventListener("mouseup", () => setPushToTalkPressed(false));
els.pttBtn.addEventListener("mouseleave", () => setPushToTalkPressed(false));
els.pttBtn.addEventListener("touchstart", () => setPushToTalkPressed(true), { passive: true });
els.pttBtn.addEventListener("touchend", () => setPushToTalkPressed(false), { passive: true });

hydrateFromUrl();
loadContacts();
renderContacts();
renderPresence();
renderHistory();
renderChat();
checkHealth().catch(() => {});
loadConfig().catch(() => {});
requestNotificationPermission().catch(() => {});
registerServiceWorker();
setBanner("waiting", "Pick your username and join", "Presence, calls, and chat stay inside the same key space.");
setTypingStatus("No one is typing.");
setDiag("diagMedia", "Audio only");
setDiag("diagCall", "Idle");
setDiag("diagIce", "Idle");
setDiag("diagStats", "No active call");
setDiag("diagVoice", "Silent");
updateButtons();

window.addEventListener("beforeunload", () => {
  state.reconnectAllowed = false;
  state.eventSource?.close();
});
