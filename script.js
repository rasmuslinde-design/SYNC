// ========== SOCKET.IO KLIENT ==========
let socket;
let gameQuestions = [];
let gameChallenges = {};

let state = {
  lang: "et",
  name: "",
  room: "",
  isHost: false,
  score: 0,
  qIdx: 0,
  questionTimer: null,
  questionTimeLeft: 20,
};

function connectSocket() {
  if (socket && socket.connected) return;
  socket = io();

  socket.on("room-created", ({ code, questions, challenges }) => {
    state.room = code;
    gameQuestions = questions;
    gameChallenges = challenges;
    document.getElementById("display-room-code").innerText = code;
    document.getElementById("start-game-btn").style.display = "flex";
    document.getElementById("wait-message").style.display = "none";
    showScreen("host-lobby-screen");
  });

  socket.on("room-joined", ({ code, questions, challenges }) => {
    state.room = code;
    gameQuestions = questions;
    gameChallenges = challenges;
    document.getElementById("display-room-code").innerText = code;
    document.getElementById("start-game-btn").style.display = "none";
    document.getElementById("wait-message").style.display = "block";
    showScreen("host-lobby-screen");
  });

  socket.on("join-error", (msg) => {
    alert(msg);
  });

  socket.on("lobby-update", (playerNames) => {
    document.getElementById("lobby-list").innerHTML = playerNames
      .map((n) => `<div class="lobby-item">${n}</div>`)
      .join("");
  });

  socket.on("game-started", () => {
    startQuestions();
  });

  socket.on("score-progress", ({ finished, total }) => {
    const loadingText = document.getElementById("loading-text");
    const loadingCount = document.getElementById("loading-count");

    if (state.lang === "et") {
      loadingText.innerText = "OOTAME TEISI MÄNGIJAID...";
      loadingCount.innerText = `${finished} / ${total} VASTANUD`;
    } else {
      loadingText.innerText = "WAITING FOR OTHER PLAYERS...";
      loadingCount.innerText = `${finished} / ${total} ANSWERED`;
    }
  });

  socket.on(
    "all-finished",
    ({ leaderboard, syncPair, bridgePair, challenges }) => {
      gameChallenges = challenges;
      document.getElementById("loading-spinner").style.display = "none";
      document.getElementById("results-content").style.display = "block";
      showLeaderboardData(leaderboard, syncPair, bridgePair);
    },
  );

  socket.on("player-left", (name) => {
    console.log(name + " lahkus ruumist.");
  });
}

// ========== EKRAANIDE HALDAMINE ==========

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function selectLanguage(l) {
  state.lang = l;
  applyLanguageToUI();
  showScreen("role-screen");
}

function applyLanguageToUI() {
  const isET = state.lang === "et";

  // Document language
  document.documentElement.lang = isET ? "et" : "en";

  // Player name
  const nameInput = document.getElementById("player-name");
  if (nameInput) nameInput.placeholder = isET ? "SINU NIMI" : "YOUR NAME";

  // Role screen buttons
  const hostBtn = document.querySelector(".btn-host");
  if (hostBtn)
    hostBtn.innerHTML = `<span class="btn-icon">🎮</span> ${isET ? "HOSTI MÄNGU" : "HOST GAME"}`;

  const joinBtn = document.querySelector(".btn-join");
  if (joinBtn)
    joinBtn.innerHTML = `<span class="btn-icon">🔗</span> ${isET ? "LIITU MÄNGUGA" : "JOIN GAME"}`;

  // Rules buttons + modal title
  const rulesOpenBtn = document.querySelector(
    'button.btn-ghost[onclick="toggleRules(true)"]',
  );
  if (rulesOpenBtn)
    rulesOpenBtn.textContent = isET ? "📖 MÄNGUREEGLID" : "📖 RULES";

  const rulesTitle = document.querySelector("#rules-modal h2");
  if (rulesTitle)
    rulesTitle.textContent = isET ? "KUIDAS MÄNGIDA?" : "HOW TO PLAY?";

  const rulesCloseBtn = document.querySelector(
    "#rules-modal button.btn-primary",
  );
  if (rulesCloseBtn) rulesCloseBtn.textContent = isET ? "SULGE" : "CLOSE";

  // Join screen
  const joinCode = document.getElementById("join-room-code");
  if (joinCode) joinCode.placeholder = isET ? "RUUMI KOOD" : "ROOM CODE";

  const joinEnterBtn = document.querySelector("#join-input-screen .btn-join");
  if (joinEnterBtn) joinEnterBtn.textContent = isET ? "SISENE →" : "ENTER →";

  // Lobby labels
  const lobbyTitle = document.querySelector("#host-lobby-screen .screen-title");
  if (lobbyTitle) lobbyTitle.textContent = isET ? "RUUM" : "ROOM";

  const lobbyStatus = document.getElementById("lobby-status");
  if (lobbyStatus)
    lobbyStatus.textContent = isET
      ? "Ootame mängijaid..."
      : "Waiting for players...";

  const startBtn = document.getElementById("start-game-btn");
  if (startBtn) startBtn.textContent = isET ? "▶ ALUSTA MÄNGU" : "▶ START GAME";

  const waitMsg = document.getElementById("wait-message");
  if (waitMsg)
    waitMsg.textContent = isET
      ? "⏳ Oota, kuni HOST alustab..."
      : "⏳ Wait for the HOST to start...";

  const leaveBtn = document.querySelector(
    "#host-lobby-screen button.btn-ghost.btn-dim",
  );
  if (leaveBtn) leaveBtn.textContent = isET ? "🚪 LAHKU" : "🚪 LEAVE";

  // Results labels
  const leaderboardTitle = document.querySelector(
    "#results-content .screen-title",
  );
  if (leaderboardTitle)
    leaderboardTitle.textContent = isET ? "EDETABEL" : "LEADERBOARD";

  const chooseChallengeLabel = document.querySelector(
    "#results-content .section-label",
  );
  if (chooseChallengeLabel)
    chooseChallengeLabel.textContent = isET
      ? "VALI VÄLJAKUTSE"
      : "CHOOSE A CHALLENGE";

  // Pair labels
  const syncLabel = document.querySelector(".sync-card .pair-label");
  if (syncLabel) syncLabel.textContent = isET ? "SARNANE PAAR" : "SYNC PAIR";

  const bridgeLabel = document.querySelector(".bridge-card .pair-label");
  if (bridgeLabel)
    bridgeLabel.textContent = isET ? "VASTANDPAAR" : "BRIDGE PAIR";

  // Back to menu button
  const homeBtn = document.querySelector(
    "#results-content button.btn-ghost.btn-dim",
  );
  if (homeBtn) homeBtn.textContent = isET ? "🏠 PEAMENÜÜSSE" : "🏠 MAIN MENU";

  // Challenge screen
  const challengeTitle = document.getElementById("challenge-title");
  if (challengeTitle)
    challengeTitle.textContent = isET ? "ÜLESANNE" : "CHALLENGE";

  const backBtn = document.querySelector("#challenge-screen button.btn-ghost");
  if (backBtn) backBtn.textContent = isET ? "← TAGASI" : "← BACK";
}

function toggleRules(show) {
  const modal = document.getElementById("rules-modal");
  if (show) {
    const rulesText = {
      et: "1. Host loob ruumi ja mängijad liituvad koodiga (max 8 in).\n2. Kõik vastavad 10-le isiksuse küsimusele (20 sek küsimus).\n3. Süsteem arvutab sinu skaala (-10 kuni +10).\n4. Edetabelis näed kahte paari: SARNASED ja VASTANDID.\n5. Valitud paar peab täitma 90-sekundilise väljakutse.",
      en: "1. Host creates a room, players join with a code (max 8).\n2. Everyone answers 10 personality questions (20 sec each).\n3. The system calculates your scale (-10 to +10).\n4. The leaderboard shows two pairs: SYNC and BRIDGE.\n5. The selected pair must complete a 90-second challenge.",
    };
    document.getElementById("rules-text").innerText = rulesText[state.lang];
    modal.style.display = "flex";
  } else {
    modal.style.display = "none";
  }
}

// ========== HOST & JOIN ==========

function setupHost() {
  state.name = document.getElementById("player-name").value.trim() || "Host";
  state.isHost = true;
  connectSocket();
  socket.emit("create-room", { name: state.name, lang: state.lang });
}

function setupJoin() {
  state.name = document.getElementById("player-name").value.trim() || "Mängija";
  connectSocket();
  showScreen("join-input-screen");
}

function joinRoom() {
  const code = document.getElementById("join-room-code").value.trim();
  if (!code) return alert("Sisesta kood!");
  state.room = code;
  state.isHost = false;
  socket.emit("join-room", { code, name: state.name });
}

function broadcastStart() {
  socket.emit("start-game");
}

// ========== KÜSIMUSED ==========

function startQuestions() {
  state.qIdx = 0;
  state.score = 0;
  showScreen("question-screen");
  updateQ();
}

function updateQ() {
  const qCount = gameQuestions.length;
  const qData = gameQuestions[state.qIdx];

  const numText =
    state.lang === "et"
      ? `KÜSIMUS ${state.qIdx + 1} / ${qCount}`
      : `QUESTION ${state.qIdx + 1} / ${qCount}`;
  document.getElementById("question-number").innerText = numText;
  document.getElementById("question-text").innerText = qData.q;
  document.getElementById("answer-left").innerText = qData.a1;
  document.getElementById("answer-right").innerText = qData.a2;

  // Küsimuse ikoon
  const iconEl = document.getElementById("question-icon");
  if (iconEl && qData.icon) {
    iconEl.innerText = qData.icon;
    iconEl.style.animation = "none";
    iconEl.offsetHeight; // reflow
    iconEl.style.animation =
      "icon-float 3s ease-in-out infinite, bounce-in 0.5s ease-out";
  }

  // Progress bar
  document.getElementById("progress-bar").style.width =
    (state.qIdx / qCount) * 100 + "%";

  // Animate question body
  const qBody = document.querySelector(".question-body");
  if (qBody) {
    qBody.style.animation = "none";
    qBody.offsetHeight;
    qBody.style.animation = "slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)";
  }

  // Küsimuse taimer (20 sekundit)
  startQuestionTimer();
}

function startQuestionTimer() {
  if (state.questionTimer) clearInterval(state.questionTimer);
  state.questionTimeLeft = 20;
  const timerEl = document.getElementById("question-timer");
  const timerCircle = document.getElementById("timer-circle");
  const circumference = 2 * Math.PI * 45; // r=45

  timerEl.innerText = state.questionTimeLeft;
  timerEl.classList.remove("timer-warning", "timer-danger");

  if (timerCircle) {
    timerCircle.style.strokeDashoffset = "0";
    timerCircle.classList.remove("timer-warning", "timer-danger");
  }

  state.questionTimer = setInterval(() => {
    state.questionTimeLeft--;
    timerEl.innerText = state.questionTimeLeft;

    // Update circular timer
    if (timerCircle) {
      const offset = circumference * (1 - state.questionTimeLeft / 20);
      timerCircle.style.strokeDashoffset = offset;
    }

    if (state.questionTimeLeft <= 5) {
      timerEl.classList.add("timer-danger");
      if (timerCircle) timerCircle.classList.add("timer-danger");
    } else if (state.questionTimeLeft <= 10) {
      timerEl.classList.add("timer-warning");
      if (timerCircle) timerCircle.classList.add("timer-warning");
    }

    if (state.questionTimeLeft <= 0) {
      clearInterval(state.questionTimer);
      handleAnswer(0);
    }
  }, 1000);
}

function handleAnswer(p) {
  if (state.questionTimer) clearInterval(state.questionTimer);
  state.score += p;
  state.qIdx++;
  if (state.qIdx < gameQuestions.length) {
    updateQ();
  } else {
    document.getElementById("progress-bar").style.width = "100%";
    finishGame();
  }
}

// ========== TULEMUSED ==========

function finishGame() {
  socket.emit("submit-score", { score: state.score });

  showScreen("result-screen");
  document.getElementById("loading-spinner").style.display = "flex";
  document.getElementById("results-content").style.display = "none";
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Returns an HSL color string.
// -10 => red, 0 => neutral, +10 => green
function scoreToColor(score) {
  const s = clamp(Number(score) || 0, -10, 10);

  // Hue: red(0) -> green(120)
  const hue = ((s + 10) / 20) * 120;

  // Saturation: stronger at extremes, softer near 0
  const abs = Math.abs(s);
  const sat = 25 + (abs / 10) * 55; // 25%..80%

  // Lightness: keep readable; slightly darker near extremes
  const light = 62 - (abs / 10) * 10; // 62%..52%

  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

function showLeaderboardData(leaderboard, syncPair, bridgePair) {
  const legend = document.getElementById("score-legend");
  if (legend) {
    const leftColor = scoreToColor(-10);
    const rightColor = scoreToColor(10);
    legend.innerHTML =
      state.lang === "et"
        ? `<span class="left" style="color:${leftColor}">-10 väga introvertne</span><span class="mid">SKAALA</span><span class="right" style="color:${rightColor}">+10 väga ekstravertne</span>`
        : `<span class="left" style="color:${leftColor}">-10 very introverted</span><span class="mid">SCALE</span><span class="right" style="color:${rightColor}">+10 very extroverted</span>`;
  }

  document.getElementById("leaderboard-list").innerHTML = leaderboard
    .map(
      (p, i) => `
        <li style="${p.name === state.name ? "border-left: 4px solid var(--blue); background: var(--blue-soft);" : ""} animation-delay: ${i * 0.1}s">
            <span>${p.name}</span>
            <span style="color: ${scoreToColor(p.score)}; font-weight: 900;">${p.score > 0 ? "+" + p.score : p.score}</span>
        </li>`,
    )
    .join("");

  if (syncPair) {
    document.getElementById("sync-names").innerText =
      syncPair.a + " & " + syncPair.b;
    document.getElementById("bridge-names").innerText =
      bridgePair.a + " & " + bridgePair.b;
  } else {
    const waitText = state.lang === "et" ? "Ootame..." : "Waiting...";
    document.getElementById("sync-names").innerText = waitText;
    document.getElementById("bridge-names").innerText = waitText;
  }
}

// ========== ÜLESANDED ==========

let timerInterval;
function showChallenge(type) {
  hideTimeUpOverlay();
  showScreen("challenge-screen");
  const prefix = state.lang === "et" ? "TEIE ÜLESANNE: " : "YOUR TASK: ";
  document.getElementById("challenge-desc").innerText =
    prefix + gameChallenges[type];
  startTimer(90);
}

function startTimer(sec) {
  if (timerInterval) clearInterval(timerInterval);
  let t = sec;
  timerInterval = setInterval(() => {
    let m = Math.floor(t / 60),
      s = t % 60;
    document.getElementById("timer").innerText =
      `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    if (t-- <= 0) {
      clearInterval(timerInterval);
      showTimeUpOverlay();
    }
  }, 1000);
}

function showTimeUpOverlay() {
  const overlay = document.getElementById("timeup-overlay");
  if (!overlay) return;

  const isET = state.lang === "et";
  const title = document.getElementById("timeup-title");
  const sub = document.getElementById("timeup-sub");
  const backBtn = document.getElementById("timeup-back");

  if (title) title.textContent = isET ? "AEG TÄIS!" : "TIME'S UP!";
  if (sub)
    sub.textContent = isET
      ? "Tagasi tulemuste juurde."
      : "Back to the results.";
  if (backBtn)
    backBtn.textContent = isET
      ? "← TAGASI SKOORIDE JUURDE"
      : "← BACK TO SCORES";

  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
}

function hideTimeUpOverlay() {
  const overlay = document.getElementById("timeup-overlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
}

function backToLeaderboard() {
  if (timerInterval) clearInterval(timerInterval);
  hideTimeUpOverlay();
  showScreen("result-screen");
}

function leaveRoom() {
  if (socket) socket.disconnect();
  showScreen("role-screen");
}
