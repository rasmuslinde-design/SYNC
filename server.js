const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname)));

// Kõik ruumid mälus
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

// Vali juhuslikult n elementi massiivist
function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

// Grouping strategy for end screen:
// - Pair extremes inwards: #1&#N, #2&#(N-1), ...
// - If odd N, the middle player is added as a 3rd member to the extremes group (#1&#N),
//   so nobody is left out.
// - Each group is classified as:
//    - "bridge" if score distance is large (more different)
//    - "sync" if score distance is small (more similar)
//   This lets us render different-looking challenge cards.
function buildEndGroups(sortedPlayers) {
  const list = [...sortedPlayers];
  const n = list.length;
  if (n < 2) return [];

  const groups = [];
  for (let left = 0, right = n - 1; left < right; left++, right--) {
    const a = list[left];
    const b = list[right];
    groups.push({
      members: [a.name, b.name],
      scores: [a.score, b.score],
    });
  }

  // Odd count => add the middle player into the extremes group as a trio
  if (n % 2 === 1) {
    const mid = list[Math.floor(n / 2)];
    if (groups[0]) {
      groups[0].members.push(mid.name);
      groups[0].scores.push(mid.score);
    }
  }

  // Classify groups: bridge vs sync by score spread.
  // Threshold: 0..20 spread possible. Using 8 keeps mid-ish pairs like (5,7) as sync,
  // and extreme pairs as bridge.
  const THRESHOLD = 8;
  for (const g of groups) {
    const min = Math.min(...g.scores);
    const max = Math.max(...g.scores);
    const spread = Math.abs(max - min);
    g.spread = spread;
    g.kind = spread >= THRESHOLD ? "bridge" : "sync";
  }

  return groups;
}

module.exports = {
  buildEndGroups,
};

io.on("connection", (socket) => {
  console.log("Ühendus:", socket.id);

  // Host loob ruumi
  socket.on("create-room", ({ name, lang }) => {
    const code = generateRoomCode();
    const selectedQuestions = pickRandom(allQuestions[lang], 10);
    const selectedSyncChallenge = pickRandom(allChallenges[lang].sync, 1)[0];
    const selectedBridgeChallenge = pickRandom(
      allChallenges[lang].bridge,
      1,
    )[0];

    rooms[code] = {
      lang,
      host: socket.id,
      started: false,
      players: [{ id: socket.id, name, score: null }],
      questions: selectedQuestions,
      challenges: {
        sync: selectedSyncChallenge,
        bridge: selectedBridgeChallenge,
      },
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;

    socket.emit("room-created", {
      code,
      lang,
      questions: selectedQuestions,
      challenges: rooms[code].challenges,
    });
    io.to(code).emit(
      "lobby-update",
      rooms[code].players.map((p) => p.name),
    );
  });

  // Mängija liitub ruumiga
  socket.on("join-room", ({ code, name, lang }) => {
    const room = rooms[code];
    if (!room) return socket.emit("join-error", "Ruumi ei leitud!");
    if (room.started) return socket.emit("join-error", "Mäng on juba alanud!");
    if (room.players.length >= 12)
      return socket.emit("join-error", "Ruum on täis!");
    if (lang && room.lang && lang !== room.lang)
      return socket.emit(
        "join-error",
        room.lang === "et"
          ? "See ruum on EESTI keeles. Vali Eesti keel ja proovi uuesti."
          : "This room is in ENGLISH. Select English and try again.",
      );
    if (room.players.find((p) => p.name === name))
      return socket.emit("join-error", "See nimi on juba võetud!");

    room.players.push({ id: socket.id, name, score: null });
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;

    socket.emit("room-joined", {
      code,
      lang: room.lang,
      questions: room.questions,
      challenges: room.challenges,
    });
    io.to(code).emit(
      "lobby-update",
      room.players.map((p) => p.name),
    );
  });

  // Host alustab mängu
  socket.on("start-game", ({ hostPlays } = {}) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    // Optional: host can act as game master (spectator)
    if (hostPlays === false) {
      room.players = room.players.filter((p) => p.id !== room.host);
    }

    room.started = true;
    io.to(code).emit("game-started");

    // If host is game master, they still need player names for the progress UI.
    if (hostPlays === false) {
      io.to(room.host).emit("gm-players", {
        players: room.players.map((p) => p.name),
      });
    }
  });

  // Host/Game Master can force everyone back to lobby (e.g., someone dropped)
  socket.on("return-to-lobby", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;

    room.started = false;
    // Reset all scores so the quiz can be started again
    room.players = room.players.map((p) => ({ ...p, score: null }));

    io.to(code).emit("return-to-lobby");
    io.to(code).emit(
      "lobby-update",
      room.players.map((p) => p.name),
    );
  });

  // Mängija saadab oma skoori
  socket.on("submit-score", ({ score }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Game master is allowed to send score:null (ignored)
    if (score !== null) {
      const player = room.players.find((p) => p.id === socket.id);
      if (player) player.score = score;
    }

    const finished = room.players.filter((p) => p.score !== null);
    const total = room.players.length;

    const answeredNames = finished.map((p) => p.name);
    const pendingNames = room.players
      .filter((p) => p.score === null)
      .map((p) => p.name);

    // Teavita kõiki progressist
    io.to(code).emit("score-progress", {
      finished: finished.length,
      total,
      answeredNames,
      pendingNames,
    });

    // Kõik on vastanud
    if (finished.length >= total) {
      const sorted = [...finished].sort((a, b) => b.score - a.score);
      const results = sorted.map((p) => ({ name: p.name, score: p.score }));

      const groups = buildEndGroups(sorted);

      // Legacy compatibility: keep two fields for older clients.
      const bridgeGroup = groups.find((g) => g.kind === "bridge") || groups[0];
      const syncGroup = groups.find((g) => g.kind === "sync") || groups[1];
      const bridgePair = bridgeGroup
        ? { a: bridgeGroup.members[0], b: bridgeGroup.members[1] }
        : null;
      const syncPair = syncGroup
        ? { a: syncGroup.members[0], b: syncGroup.members[1] }
        : null;

      io.to(code).emit("all-finished", {
        leaderboard: results,
        // New UI can render all of these.
        groups: groups.map((g) => ({
          kind: g.kind,
          members: g.members,
          spread: g.spread,
        })),

        // Old UI uses these two.
        syncPair,
        bridgePair,
        challenges: room.challenges,
      });
    }
  });

  // Ühenduse katkestamine
  socket.on("disconnect", () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];
    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[code];
      console.log("Ruum kustutatud:", code);
    } else {
      // Kui host lahkub, määra uus host
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      io.to(code).emit(
        "lobby-update",
        room.players.map((p) => p.name),
      );
      io.to(code).emit("player-left", socket.playerName);
    }
  });
});

// ========== KÜSIMUSTE JA ÜLESANNETE ANDMEBAAS ==========

const allQuestions = {
  et: [
    {
      q: "Kas usaldad pigem...",
      a1: "Andmeid ja loogikat",
      a2: "Sisetunnet ja empaatiat",
      icon: "🧠",
    },
    {
      q: "Seltskonnas oled pigem...",
      a1: "Vaatleja ja kuulaja",
      a2: "Aktiivne rääkija",
      icon: "👥",
    },
    {
      q: "Vabal ajal eelistad...",
      a1: "Rutiini ja rahu",
      a2: "Uusi seiklusi ja melu",
      icon: "🎯",
    },
    {
      q: "Probleeme lahendad...",
      a1: "Üksi süvenedes",
      a2: "Teistega arutades",
      icon: "🔧",
    },
    { q: "Sinu energiaallikas...", a1: "Vaikus", a2: "Inimesed", icon: "⚡" },
    {
      q: "Konflikti korral...",
      a1: "Väldin seda",
      a2: "Lahendun kohe",
      icon: "⚔️",
    },
    {
      q: "Reisil eelistad...",
      a1: "Detailset plaani",
      a2: "Spontaanset seiklust",
      icon: "✈️",
    },
    {
      q: "Muusika kuulamisel...",
      a1: "Keskendun sõnadele",
      a2: "Lasen end rütmil kanda",
      icon: "🎵",
    },
    {
      q: "Uues seltskonnas...",
      a1: "Ootan, et keegi alustaks",
      a2: "Alustan ise juttu",
      icon: "🗣️",
    },
    {
      q: "Kingitusi valid...",
      a1: "Praktilisi asju",
      a2: "Emotsionaalselt tähendusrikkaid",
      icon: "🎁",
    },
    {
      q: "Hommikul eelistad...",
      a1: "Vaikset ärkamist",
      a2: "Energilist algust",
      icon: "🌅",
    },
    {
      q: "Sõprade ringis oled...",
      a1: "Nõuandja ja kuulaja",
      a2: "Nalja tegija ja lõbustaja",
      icon: "😄",
    },
    {
      q: "Tööl motiveerib sind...",
      a1: "Iseseisvus ja vabadus",
      a2: "Meeskonnatöö ja koostöö",
      icon: "💼",
    },
    {
      q: "Filmi vaatamisel eelistad...",
      a1: "Dokumentaalfilme",
      a2: "Märulifilme",
      icon: "🎬",
    },
    {
      q: "Otsuseid teed pigem...",
      a1: "Kaalutletult ja aeglaselt",
      a2: "Kiiresti ja intuitiivselt",
      icon: "⚖️",
    },
    {
      q: "Sinu ideaalne õhtu on...",
      a1: "Raamat ja teekruus",
      a2: "Pidu ja sõbrad",
      icon: "🌙",
    },
    {
      q: "Stressis olles...",
      a1: "Tõmbun endasse",
      a2: "Räägin kellegagi",
      icon: "😰",
    },
    {
      q: "Sinu elumotto on pigem...",
      a1: "Mõtle enne kui teed",
      a2: "Kes ei riski, see ei võida",
      icon: "💡",
    },
    {
      q: "Rühmatöös oled pigem...",
      a1: "Organiseerija",
      a2: "Ideede generaator",
      icon: "🏗️",
    },
    {
      q: "Loomadest eelistad...",
      a1: "Kasse (iseseisvad)",
      a2: "Koeri (sotsiaalsed)",
      icon: "🐾",
    },
    {
      q: "Spordis eelistad...",
      a1: "Individuaalsporti",
      a2: "Meeskonnasporti",
      icon: "🏅",
    },
    {
      q: "Söögi osas oled...",
      a1: "Traditsionalist",
      a2: "Eksperimenteerija",
      icon: "🍽️",
    },
    {
      q: "Raha osas oled...",
      a1: "Säästja ja planeerija",
      a2: "Spontaanne kulutaja",
      icon: "💰",
    },
    {
      q: "Õppimise viis...",
      a1: "Loen ja uurin ise",
      a2: "Õpin teistelt ja arutlen",
      icon: "📚",
    },
    {
      q: "Sinu tuju mõjutab...",
      a1: "Ilm ja keskkond",
      a2: "Ümbritsevad inimesed",
      icon: "🌤️",
    },
    {
      q: "Puhkusel eelistad...",
      a1: "Loodust ja rahu",
      a2: "Linna ja tegevusi",
      icon: "🏖️",
    },
    {
      q: "Aeg on sinu jaoks...",
      a1: "Ressurss, mida planeerida",
      a2: "Vool, millega kaasa minna",
      icon: "⏳",
    },
    {
      q: "Kriitika suhtes oled...",
      a1: "Analüüsin ja võtan arvesse",
      a2: "Reageerin emotsionaalselt",
      icon: "🪞",
    },
    {
      q: "Tulevikku vaadates...",
      a1: "Planeerid detailselt",
      a2: "Usaldad, et kõik laabub",
      icon: "🔮",
    },
    {
      q: "Sinu tugevus on...",
      a1: "Loogika ja analüüs",
      a2: "Empaatia ja suhtlus",
      icon: "💪",
    },
    {
      q: "Nädalavahetusel eelistad...",
      a1: "Kodus olemist",
      a2: "Välja minekut",
      icon: "🏠",
    },
    {
      q: "Uute inimestega tutvudes...",
      a1: "Oled ettevaatlik",
      a2: "Oled avatud ja sõbralik",
      icon: "🤝",
    },
  ],
  en: [
    {
      q: "Do you trust more...",
      a1: "Data and logic",
      a2: "Gut feeling and empathy",
      icon: "🧠",
    },
    {
      q: "In a group, you are...",
      a1: "Observer and listener",
      a2: "Active talker",
      icon: "👥",
    },
    {
      q: "In free time, you prefer...",
      a1: "Routine and peace",
      a2: "New adventures and buzz",
      icon: "🎯",
    },
    {
      q: "Solving problems...",
      a1: "Deep dive alone",
      a2: "Discussing with others",
      icon: "🔧",
    },
    { q: "Your energy source...", a1: "Silence", a2: "People", icon: "⚡" },
    {
      q: "In a conflict...",
      a1: "I avoid it",
      a2: "I address it immediately",
      icon: "⚔️",
    },
    {
      q: "When traveling...",
      a1: "Detailed plan",
      a2: "Spontaneous adventure",
      icon: "✈️",
    },
    {
      q: "Listening to music...",
      a1: "Focus on lyrics",
      a2: "Let the rhythm carry me",
      icon: "🎵",
    },
    {
      q: "In new company...",
      a1: "Wait for others to start",
      a2: "Start the conversation",
      icon: "🗣️",
    },
    {
      q: "Choosing gifts...",
      a1: "Practical things",
      a2: "Emotionally meaningful",
      icon: "🎁",
    },
    {
      q: "In the morning...",
      a1: "Quiet waking up",
      a2: "Energetic start",
      icon: "🌅",
    },
    {
      q: "Among friends you are...",
      a1: "Advisor and listener",
      a2: "Joker and entertainer",
      icon: "😄",
    },
    {
      q: "At work you're motivated by...",
      a1: "Independence and freedom",
      a2: "Teamwork and collaboration",
      icon: "💼",
    },
    {
      q: "Watching movies you prefer...",
      a1: "Documentaries",
      a2: "Action films",
      icon: "🎬",
    },
    {
      q: "Making decisions...",
      a1: "Carefully and slowly",
      a2: "Quickly and intuitively",
      icon: "⚖️",
    },
    {
      q: "Your ideal evening is...",
      a1: "Book and tea",
      a2: "Party and friends",
      icon: "🌙",
    },
    {
      q: "When stressed...",
      a1: "I withdraw",
      a2: "I talk to someone",
      icon: "😰",
    },
    {
      q: "Your life motto is...",
      a1: "Think before you act",
      a2: "No risk, no reward",
      icon: "💡",
    },
    {
      q: "In group work you are...",
      a1: "Organizer",
      a2: "Idea generator",
      icon: "🏗️",
    },
    {
      q: "You prefer animals...",
      a1: "Cats (independent)",
      a2: "Dogs (social)",
      icon: "🐾",
    },
    {
      q: "In sports you prefer...",
      a1: "Individual sports",
      a2: "Team sports",
      icon: "🏅",
    },
    {
      q: "About food you are...",
      a1: "Traditionalist",
      a2: "Experimenter",
      icon: "🍽️",
    },
    {
      q: "About money you are...",
      a1: "Saver and planner",
      a2: "Spontaneous spender",
      icon: "💰",
    },
    {
      q: "Learning style...",
      a1: "Read and research alone",
      a2: "Learn from others and discuss",
      icon: "📚",
    },
    {
      q: "Your mood is affected by...",
      a1: "Weather and environment",
      a2: "Surrounding people",
      icon: "🌤️",
    },
    {
      q: "On vacation you prefer...",
      a1: "Nature and peace",
      a2: "City and activities",
      icon: "🏖️",
    },
    {
      q: "Time for you is...",
      a1: "A resource to plan",
      a2: "A flow to go with",
      icon: "⏳",
    },
    {
      q: "About criticism...",
      a1: "I analyze and consider",
      a2: "I react emotionally",
      icon: "🪞",
    },
    {
      q: "Looking at the future...",
      a1: "Plan in detail",
      a2: "Trust it will work out",
      icon: "🔮",
    },
    {
      q: "Your strength is...",
      a1: "Logic and analysis",
      a2: "Empathy and communication",
      icon: "💪",
    },
    {
      q: "On weekends you prefer...",
      a1: "Staying home",
      a2: "Going out",
      icon: "🏠",
    },
    {
      q: "Meeting new people...",
      a1: "You're cautious",
      a2: "You're open and friendly",
      icon: "🤝",
    },
  ],
};

const allChallenges = {
  et: {
    sync: [
      "Nimetage 90 sekundi jooksul 5 filmi/sarja, mis teile mõlemale meeldivad.",
      "Nimetage 3 toitu, mida te mõlemad vihkate.",
      "Leidke 3 hirmu, mis teil mõlemal on.",
      "Kirjeldage oma ideaalset nädalavahetust — leidke vähemalt 3 kattuvust.",
      "Leidke üks teema, milles olete eri meelel ja selgitage teineteisele miks.",
      "Kas pitsa ananassiga on vastuvõetav?",
      "Arutage: kas hommikuti peab vara ärkama või on öökull olla parem?",
      "Valige üks koht maailmas, kuhu te mõlemad tahaksite reisida.",
      "Otsustage üks oskus, mida iga inimene võiks elus õppida.",
      "Mõelge üks tegevus, mis aitab inimestel kiiresti paremini üksteist tundma õppida.",
      "Leidke üks asi, mis teeb ühe seltskonnaõhtu tõeliselt heaks.",
      "Leidke 90 sekundi jooksul 3 asja, mida te mõlemad südamest vihkate (nt rosinad saia sees, hilinevad bussid, hirmutavad klounid).",
    ],
    bridge: [
      "Debateerige: kas raha toob õnne?",
      "Vaielge: kas linnas elamine on parem kui maal?",
      "Debateerige: kas ausus on ALATI parim poliitika? Valige pooled!",
      "Vaielge: kas AI on inimkonna jaoks hea või ohtlik?",
      "Debateerige: kas populaarne muusika on parem kui alternatiivne?",
      "Otsustage üks tegevus, mida teie arvates enamik inimesi siin ruumis alahindab.",
      "Üks teist on tulnukas, teine inimene. Inimene peab selgitama tulnukale mõnda abstraktset mõistet (nt armastus või stress) ilma tundeid kirjeldavaid sõnu kasutamata.",
      "Kui te oleksite kokteil, siis mis koostisosad seal oleksid? Leidke üks magus ja üks vürtsikas komponent, mis esindavad teie iseloomusid, ning mõelge joogile nimi.",
      "Debatt: kas hommikusöök on päeva olulisim toidukord? Pärast arutelu peate 1 minuti jooksul kaitsma teise poole seisukohta nii veenvalt kui võimalik.",
      "Valige koos kingitus kolmandale inimesele, keda te kumbki ei tunne, tuginedes vaid ühele juhuslikule faktile (nt talle meeldib kollane värv).",
    ],
  },
  en: {
    sync: [
      "Name 5 movies/shows you both like within 90 seconds.",
      "Name 3 foods you both hate.",
      "Find 3 fears you both have.",
      "Describe your ideal weekend — find at least 3 overlaps.",
      "Find one topic you disagree on and explain to each other why.",
      "Debate whether pineapple on pizza is acceptable.",
      "Discuss: is it better to wake up early, or is the night-owl life better?",
      "Pick one place in the world you’d both like to travel to.",
      "Agree on one skill every person should learn in life.",
      "Come up with one activity that helps people get to know each other quickly.",
      "Find one thing that makes a hangout night truly great.",
      "Within 90 seconds, find 3 things you both truly hate (e.g., raisins in buns, late buses, scary clowns).",
    ],
    bridge: [
      "Debate: does money bring happiness?",
      "Argue: is living in the city better than living in the countryside?",
      "Debate: is honesty ALWAYS the best policy? Pick sides!",
      "Argue: is AI good for humanity or dangerous?",
      "Debate: is pop music better than alternative music?",
      "Agree on one activity that you think most people in this room underestimate.",
      "One of you is an alien, the other is a human. The human must explain an abstract concept (e.g., love or stress) to the alien without using emotion words.",
      "If you were a cocktail, what ingredients would you be? Pick one sweet and one spicy component that represent your personalities, and name the drink.",
      "Debate: is breakfast the most important meal of the day? After the debate, switch sides and defend the other side’s view as convincingly as possible for 1 minute.",
      "Choose a gift together for a third person you both don’t know, based on only one random fact (e.g., they like the color yellow).",
    ],
  },
};

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`SYNC server käivitatud: http://localhost:${PORT}`);
  });
}
