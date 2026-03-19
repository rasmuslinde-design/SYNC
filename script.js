// ========== SOCKET.IO KLIENT ==========
let socket;
let gameQuestions = [];
let gameChallenges = {};

let state = {
  lang: "et",
  name: "",
  room: "",
  isHost: false,
  hostPlays: true,
  score: 0,
  qIdx: 0,
  questionTimer: null,
  questionTimeLeft: 20,
  endGroups: [],
  gmIdx: 0,
  gmPlayers: [],
  gmAnswered: [],
  gmPending: [],
};

function isGameMaster() {
  return state.isHost && state.hostPlays === false;
}

function connectSocket() {
  if (socket && socket.connected) return;
  socket = io();

  socket.on("room-created", ({ code, lang, questions, challenges }) => {
    state.room = code;
    if (lang && (lang === "et" || lang === "en")) {
      state.lang = lang;
      applyLanguageToUI();
    }
    gameQuestions = questions;
    gameChallenges = challenges;
    document.getElementById("display-room-code").innerText = code;
    document.getElementById("start-game-btn").style.display = "flex";
    document.getElementById("wait-message").style.display = "none";

    // Host-only: show host mode toggle
    const hostBox = document.getElementById("host-mode-box");
    if (hostBox) hostBox.style.display = "block";
    const toggle = document.getElementById("host-plays-toggle");
    if (toggle) {
      toggle.checked = !!state.hostPlays;
      toggle.onchange = () => {
        state.hostPlays = !!toggle.checked;

        // If switching to "host plays", make sure any GM overlay from a previous run is closed.
        if (state.hostPlays) {
          stopGameMasterView();
        }
      };
    }

    showScreen("host-lobby-screen");
  });

  socket.on("room-joined", ({ code, lang, questions, challenges }) => {
    state.room = code;
    if (lang && (lang === "et" || lang === "en")) {
      state.lang = lang;
      applyLanguageToUI();
    }
    gameQuestions = questions;
    gameChallenges = challenges;
    document.getElementById("display-room-code").innerText = code;
    document.getElementById("start-game-btn").style.display = "none";
    document.getElementById("wait-message").style.display = "block";

    // Joiners never see host option
    const hostBox = document.getElementById("host-mode-box");
    if (hostBox) hostBox.style.display = "none";

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

  socket.on("return-to-lobby", () => {
    // Reset client-side game state
    if (state.questionTimer) clearInterval(state.questionTimer);
    state.questionTimer = null;
    state.questionTimeLeft = 20;
    state.qIdx = 0;
    state.gmIdx = 0;

    // Default back to "host plays" so toggle state is predictable after a reset.
    state.hostPlays = true;
    const toggle = document.getElementById("host-plays-toggle");
    if (toggle) toggle.checked = true;

    // Ensure GM overlay isn't lingering
    stopGameMasterView();

    // Ensure GM overlay isn't stuck on
    if (isGameMaster()) stopGameMasterView();

    // Restore UI pieces just in case
    const answers = document.querySelector(".answer-cards");
    if (answers) {
      answers.style.pointerEvents = "auto";
      answers.style.display = "flex";
    }
    const timerContainer = document.getElementById("timer-circle-container");
    if (timerContainer) timerContainer.style.visibility = "visible";

    // Back to lobby
    showScreen("host-lobby-screen");
  });

  socket.on("game-started", () => {
    startQuestions();
  });

  socket.on("gm-players", ({ players }) => {
    if (!isGameMaster()) return;
    state.gmPlayers = Array.isArray(players) ? players : [];
    // Until we get score-progress, everyone is pending.
    state.gmAnswered = [];
    state.gmPending = [...state.gmPlayers];
    renderGameMasterPlayers();
  });

  socket.on(
    "score-progress",
    ({ finished, total, answeredNames, pendingNames }) => {
      const loadingText = document.getElementById("loading-text");
      const loadingCount = document.getElementById("loading-count");

      if (state.lang === "et") {
        loadingText.innerText = "OOTAME TEISI MÄNGIJAID...";
        loadingCount.innerText = `${finished} / ${total} VASTANUD`;
      } else {
        loadingText.innerText = "WAITING FOR OTHER PLAYERS...";
        loadingCount.innerText = `${finished} / ${total} ANSWERED`;
      }

      updateGameMasterProgress(finished, total);

      if (isGameMaster()) {
        if (Array.isArray(answeredNames)) state.gmAnswered = answeredNames;
        if (Array.isArray(pendingNames)) state.gmPending = pendingNames;
        renderGameMasterPlayers();
      }
    },
  );

  socket.on(
    "all-finished",
    ({ leaderboard, syncPair, bridgePair, groups, challenges }) => {
      gameChallenges = challenges;
      state.endGroups = Array.isArray(groups) ? groups : [];

      if (isGameMaster()) stopGameMasterView();

      document.getElementById("loading-spinner").style.display = "none";
      document.getElementById("results-content").style.display = "block";
      showScreen("result-screen");
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

  // Credits: show on menu/lobby-type screens, hide during gameplay/overlays.
  const hideCreditsScreens = new Set([
    "question-screen",
    "waiting-screen",
    "result-screen",
    "challenge-screen",
  ]);
  document.body.classList.toggle("hide-credits", hideCreditsScreens.has(id));
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

  // Generic back buttons on menu screens
  const backToLangBtn = document.querySelector(
    "#role-screen button.btn-ghost.btn-dim[onclick=\"showScreen('language-screen')\"]",
  );
  if (backToLangBtn) backToLangBtn.textContent = isET ? "← TAGASI" : "← BACK";

  const backToRoleBtn = document.querySelector(
    "#join-input-screen button.btn-ghost.btn-dim[onclick=\"showScreen('role-screen')\"]",
  );
  if (backToRoleBtn) backToRoleBtn.textContent = isET ? "← TAGASI" : "← BACK";

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

  // Host mode toggle (only visible for host)
  const hostModeTitle = document.getElementById("host-mode-title");
  if (hostModeTitle)
    hostModeTitle.textContent = isET ? "HOSTI REŽIIM" : "HOST MODE";

  const hostPlaysLabel = document.getElementById("host-plays-label");
  if (hostPlaysLabel)
    hostPlaysLabel.textContent = isET
      ? "HOST mängib kaasa"
      : "Host plays along";

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

  const backBtn = document.getElementById("challenge-back");
  if (backBtn) backBtn.textContent = isET ? "← TAGASI" : "← BACK";

  // GM back button
  const gmBack = document.getElementById("gm-back-room");
  if (gmBack) gmBack.textContent = isET ? "← TAGASI RUUMI" : "← BACK TO ROOM";
}

function toggleRules(show) {
  const modal = document.getElementById("rules-modal");
  if (show) {
    const rulesText = {
      et: "1. Host loob ruumi ja mängijad liituvad koodiga (max 12).\n2. Host saab valida, kas mängib kaasa või on GAME MASTER.\n3. Kõik mängijad vastavad 10-le isiksuse küsimusele (20 sek küsimus).\n4. Süsteem arvutab sinu skaala (-10 kuni +10).\n5. Lõpus tekivad mitmed paarid/kolmikud ning HOST avab väljakutsed.\n6. Valitud grupp täidab 90-sekundilise väljakutse.",
      en: "1. Host creates a room, players join with a code (max 12).\n2. The host can choose to play or be a GAME MASTER.\n3. All players answer 10 personality questions (20 sec each).\n4. The system calculates your scale (-10 to +10).\n5. The end screen creates multiple pairs/trios, and the HOST opens challenges.\n6. The selected group completes a 90-second challenge.",
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
  state.name =
    document.getElementById("player-name").value.trim() ||
    (state.lang === "et" ? "Mängija" : "Player");
  connectSocket();
  showScreen("join-input-screen");
}

function joinRoom() {
  const code = document.getElementById("join-room-code").value.trim();
  if (!code)
    return alert(state.lang === "et" ? "Sisesta kood!" : "Enter a code!");
  state.room = code;
  state.isHost = false;
  socket.emit("join-room", { code, name: state.name, lang: state.lang });
}

function broadcastStart() {
  // Always read from the toggle right before starting (avoids stale state)
  const toggle = document.getElementById("host-plays-toggle");
  if (toggle) state.hostPlays = !!toggle.checked;
  socket.emit("start-game", { hostPlays: !!state.hostPlays });
}

// ========== KÜSIMUSED ==========

function startQuestions() {
  state.qIdx = 0;
  state.score = 0;
  // If host is game master, they don't play.
  if (state.isHost && !state.hostPlays) {
    startGameMasterView();
    return;
  }
  showScreen("question-screen");
  updateQ();
}

function startGameMasterView() {
  // Game master is excluded from scoring; just observe.
  socket.emit("submit-score", { score: null });

  showScreen("question-screen");
  state.gmIdx = 0;

  const gm = document.getElementById("gm-overlay");
  if (gm) gm.style.display = "flex";

  // Disable answering UI
  const answers = document.querySelector(".answer-cards");
  if (answers) {
    answers.style.pointerEvents = "none";
    answers.style.display = "none";
  }

  // Hide question timer for game master
  const timerContainer = document.getElementById("timer-circle-container");
  if (timerContainer) timerContainer.style.visibility = "hidden";

  // Localize GM players panel labels
  const isET = state.lang === "et";
  const t = document.getElementById("gm-players-title");
  const p1 = document.getElementById("gm-pending-title");
  const p2 = document.getElementById("gm-answered-title");
  if (t) t.textContent = isET ? "MÄNGIJAD" : "PLAYERS";
  if (p1) p1.textContent = isET ? "VASTAMAS" : "ANSWERING";
  if (p2) p2.textContent = isET ? "VASTANUD" : "ANSWERED";

  // Clear lists until first server update (or gm-players event)
  if (!Array.isArray(state.gmPlayers) || state.gmPlayers.length === 0) {
    state.gmAnswered = [];
    state.gmPending = [];
  }
  renderGameMasterPlayers();

  renderGameMasterCard();
}

function stopGameMasterView() {
  const gm = document.getElementById("gm-overlay");
  if (gm) gm.style.display = "none";

  const answers = document.querySelector(".answer-cards");
  if (answers) {
    answers.style.pointerEvents = "auto";
    answers.style.display = "flex";
  }

  const timerContainer = document.getElementById("timer-circle-container");
  if (timerContainer) timerContainer.style.visibility = "visible";

  // Reset GM state
  state.gmPlayers = [];
  state.gmAnswered = [];
  state.gmPending = [];
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

function updateGameMasterProgress(finished, total) {
  if (!isGameMaster()) return;
  const el = document.getElementById("gm-progress");
  if (!el) return;
  el.textContent =
    state.lang === "et"
      ? `${finished} / ${total} vastanud`
      : `${finished} / ${total} answered`;

  // In GM panel we label it as "VASTAMAS" / "ANSWERING" but keep the same numbers
  // (finished so far out of total), as requested.
  const meta = document.getElementById("gm-players-meta");
  if (meta)
    meta.textContent =
      state.lang === "et"
        ? `VASTAMAS ${finished} / ${total}`
        : `ANSWERING ${finished} / ${total}`;
}

function renderGameMasterPlayers() {
  if (!isGameMaster()) return;
  const pendingEl = document.getElementById("gm-pending-list");
  const answeredEl = document.getElementById("gm-answered-list");
  if (!pendingEl || !answeredEl) return;

  const pending = Array.isArray(state.gmPending) ? state.gmPending : [];
  const answered = Array.isArray(state.gmAnswered) ? state.gmAnswered : [];

  const renderPills = (names, status) => {
    if (!names.length) {
      return `<div class="gm-pill" style="opacity:0.55; justify-content:center">${
        state.lang === "et" ? "—" : "—"
      }</div>`;
    }
    return names
      .map(
        (n) =>
          `<div class="gm-pill"><span>${escapeHtml(n)}</span><small>${status}</small></div>`,
      )
      .join("");
  };

  pendingEl.innerHTML = renderPills(
    pending,
    state.lang === "et" ? "..." : "...",
  );
  answeredEl.innerHTML = renderPills(
    answered,
    state.lang === "et" ? "OK" : "OK",
  );
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderGameMasterCard() {
  if (!isGameMaster()) return;
  const qCount = gameQuestions.length || 0;
  if (!qCount) return;

  const idx = clamp(state.gmIdx, 0, qCount - 1);
  state.gmIdx = idx;
  const qData = gameQuestions[idx];

  const qnum = document.getElementById("gm-qnum");
  const icon = document.getElementById("gm-icon");
  const q = document.getElementById("gm-q");
  const badge = document.getElementById("gm-badge");

  if (badge)
    badge.textContent =
      state.lang === "et" ? "🎛️ GAME MASTER" : "🎛️ GAME MASTER";

  if (qnum)
    qnum.textContent =
      state.lang === "et"
        ? `KÜSIMUS ${idx + 1} / ${qCount}`
        : `QUESTION ${idx + 1} / ${qCount}`;
  if (icon) icon.textContent = qData.icon || "🧠";
  if (q) q.textContent = qData.q;

  // Enable/disable nav buttons
  const prevBtn = document.getElementById("gm-prev");
  const nextBtn = document.getElementById("gm-next");
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= qCount - 1;
}

// Called by buttons in index.html
function gmNext() {
  if (!isGameMaster()) return;
  state.gmIdx = Math.min((gameQuestions.length || 1) - 1, state.gmIdx + 1);
  renderGameMasterCard();
}

function gmPrev() {
  if (!isGameMaster()) return;
  state.gmIdx = Math.max(0, state.gmIdx - 1);
  renderGameMasterCard();
}

function gmBackToRoom() {
  if (!isGameMaster()) return;
  // Ask server to return everyone to the lobby and allow restarting.
  // Also do it locally right away so it works even in solo testing.
  if (socket && socket.connected) socket.emit("return-to-lobby");
  showScreen("host-lobby-screen");
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
        ? `<span class="left" style="color:${leftColor}"><button class="legend-mini" onclick="showAnimalLegend('cat')">🐱</button> -10 KASS</span><span class="mid">SKAALA</span><span class="right" style="color:${rightColor}">+10 KOER <button class="legend-mini" onclick="showAnimalLegend('dog')">🐶</button></span>`
        : `<span class="left" style="color:${leftColor}"><button class="legend-mini" onclick="showAnimalLegend('cat')">🐱</button> -10 CAT</span><span class="mid">SCALE</span><span class="right" style="color:${rightColor}">+10 DOG <button class="legend-mini" onclick="showAnimalLegend('dog')">🐶</button></span>`;
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

  renderEndChallengeCards(syncPair, bridgePair);
}

function showAnimalLegend(which) {
  const isET = state.lang === "et";
  const copy = {
    cat: {
      etTitle: "🐱 KASS (introvertne pool)",
      enTitle: "🐱 CAT (introverted side)",
      et: "KASS tähendab: laed energiat vaikuses, eelistad väiksemaid seltskondi, mõtled enne kui räägid ja naudid oma ruumi.\n\nSee ei tähenda 'häbelik' — lihtsalt rahulik ja selektiivne sotsiaalsuses.",
      en: "CAT means: you recharge in quiet, prefer smaller groups, think before you speak, and enjoy your own space.\n\nIt doesn't mean 'shy' — just calm and selective socially.",
    },
    dog: {
      etTitle: "🐶 KOER (ekstravertne pool)",
      enTitle: "🐶 DOG (extroverted side)",
      et: "KOER tähendab: laed energiat inimestega, alustad kergemini vestlust, naudid aktiivset seltskonda ja tahad olla 'möllu sees'.\n\nSee ei tähenda 'valju' — lihtsalt sotsiaalselt energiline.",
      en: "DOG means: you recharge with people, start conversations easily, enjoy active social settings, and like being in the middle of the action.\n\nIt doesn't mean 'loud' — just socially energetic.",
    },
  };

  const c = copy[which];
  if (!c) return;
  const title = isET ? c.etTitle : c.enTitle;
  const body = isET ? c.et : c.en;

  showInfoModal(title, body);
}

function showInfoModal(title, body) {
  const modal = document.getElementById("info-modal");
  const t = document.getElementById("info-title");
  const b = document.getElementById("info-body");
  if (!modal || !t || !b) return;
  t.textContent = title;
  b.textContent = body;
  modal.style.display = "flex";
}

function closeInfoModal() {
  const modal = document.getElementById("info-modal");
  if (!modal) return;
  modal.style.display = "none";
}

function renderEndChallengeCards(syncPair, bridgePair) {
  const grid = document.querySelector("#results-content .pair-grid");
  if (!grid) return;

  // If server sent groups, render all as cards.
  if (Array.isArray(state.endGroups) && state.endGroups.length > 0) {
    grid.innerHTML = state.endGroups
      .map((g, idx) => {
        const members = Array.isArray(g.members) ? g.members : [];
        const isBridge = g.kind === "bridge";
        const emoji = isBridge ? "🌉" : "🔗";
        const cardClass = isBridge ? "bridge-card" : "sync-card";
        const label =
          state.lang === "et"
            ? isBridge
              ? "VASTANDPAAR"
              : "SARNANE PAAR"
            : isBridge
              ? "BRIDGE"
              : "SYNC";

        const namesText = members.join(" & ");

        return `
          <div class="pair-card ${cardClass} glass-card" onclick="showGroupChallenge(${idx})">
            <span class="pair-emoji">${emoji}</span>
            <div class="pair-label">${label}</div>
            <div class="pair-names">${namesText || "..."}</div>
          </div>
        `;
      })
      .join("");
    return;
  }

  // Fallback: keep the original 2-card UI
  const syncNames = document.getElementById("sync-names");
  const bridgeNames = document.getElementById("bridge-names");
  if (!syncNames || !bridgeNames) return;

  if (syncPair) {
    syncNames.innerText = syncPair.a + " & " + syncPair.b;
    bridgeNames.innerText = bridgePair.a + " & " + bridgePair.b;
  } else {
    const waitText = state.lang === "et" ? "Ootame..." : "Waiting...";
    syncNames.innerText = waitText;
    bridgeNames.innerText = waitText;
  }
}

function showGroupChallenge(groupIndex) {
  const g = state.endGroups?.[groupIndex];
  if (!g) return;

  // Pick challenge text by kind
  const kind = g.kind === "bridge" ? "bridge" : "sync";
  showScreen("challenge-screen");
  hideTimeUpOverlay();

  const prefix = state.lang === "et" ? "TEIE ÜLESANNE: " : "YOUR TASK: ";
  document.getElementById("challenge-desc").innerText =
    prefix + gameChallenges[kind];
  startTimer(90);
}

// Legacy handler (older UI / fallback)
function showChallenge(type) {
  hideTimeUpOverlay();
  showScreen("challenge-screen");
  const prefix = state.lang === "et" ? "TEIE ÜLESANNE: " : "YOUR TASK: ";
  document.getElementById("challenge-desc").innerText =
    prefix + gameChallenges[type];
  startTimer(90);
}

// ========== ÜLESANDED ==========

let timerInterval;

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
