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
      questions: selectedQuestions,
      challenges: rooms[code].challenges,
    });
    io.to(code).emit(
      "lobby-update",
      rooms[code].players.map((p) => p.name),
    );
  });

  // Mängija liitub ruumiga
  socket.on("join-room", ({ code, name }) => {
    const room = rooms[code];
    if (!room) return socket.emit("join-error", "Ruumi ei leitud!");
    if (room.started) return socket.emit("join-error", "Mäng on juba alanud!");
    if (room.players.length >= 8)
      return socket.emit("join-error", "Ruum on täis!");
    if (room.players.find((p) => p.name === name))
      return socket.emit("join-error", "See nimi on juba võetud!");

    room.players.push({ id: socket.id, name, score: null });
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;

    socket.emit("room-joined", {
      code,
      questions: room.questions,
      challenges: room.challenges,
    });
    io.to(code).emit(
      "lobby-update",
      room.players.map((p) => p.name),
    );
  });

  // Host alustab mängu
  socket.on("start-game", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.started = true;
    io.to(code).emit("game-started");
  });

  // Mängija saadab oma skoori
  socket.on("submit-score", ({ score }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (player) player.score = score;

    const finished = room.players.filter((p) => p.score !== null);
    const total = room.players.length;

    // Teavita kõiki progressist
    io.to(code).emit("score-progress", {
      finished: finished.length,
      total,
    });

    // Kõik on vastanud
    if (finished.length >= total) {
      const sorted = [...finished].sort((a, b) => b.score - a.score);
      const results = sorted.map((p) => ({ name: p.name, score: p.score }));

      let syncPair = null;
      let bridgePair = null;

      if (sorted.length >= 2) {
        syncPair = { a: sorted[0].name, b: sorted[1].name };
        bridgePair = {
          a: sorted[0].name,
          b: sorted[sorted.length - 1].name,
        };
      }

      io.to(code).emit("all-finished", {
        leaderboard: results,
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
      "Leidke 90 sekundi jooksul 3 ühist asja, mida te mõlemad kirglikult vihkate.",
      "Nimetage 90 sekundi jooksul 5 filmi/sarja, mis teile mõlemale meeldivad.",
      "Leidke 3 toitu, mida te mõlemad armastate, ja 3 toitu, mida vihkate.",
      "Kirjeldage teineteisele oma ideaalset puhkust — leidke 3 ühist joont.",
      "Leidke 3 laulu/artisti, mis teile mõlemale meeldivad, ja laulge koos!",
      "Nimetage 5 asja, mis teid mõlemat kõige rohkem närvi ajavad.",
      "Leidke 3 lapsepõlvemälestust, mis on üllatavalt sarnased.",
      "Kirjeldage oma halbimat kohtingukogemust — leidke sarnasusi!",
      "Leidke 3 superjõudu, mida te mõlemad tahaksite omada.",
      "Nimetage 5 asja oma äratuskellas, mis on samad (rutiin, harjumused).",
      "Koostage ühine TOP 3 unistuste reisisihtkoht.",
      "Leidke 3 hirmu, mis teil mõlemal on.",
      "Nimetage 3 kuulsust, kellega te mõlemad tahaksite õhtust süüa.",
      "Leidke 3 ühist veidrat harjumust, mida te avalikult ei tunnistaks.",
      "Kirjeldage oma ideaalset nädalavahetust — leidke vähemalt 3 kattuvust.",
    ],
    bridge: [
      "Leidke üks teema, milles olete eri meelel ja selgitage teineteisele miks.",
      "Üks teist peab väitma, et kass on parem — teine, et koer. Veenge teineteist!",
      "Vaielge selle üle, kas pitsa ananassiga on vastuvõetav. 90 sekundit!",
      "Üks arvab, et hommikuti peab vara ärkama — teine, et öökull olla on parem. Debatt!",
      "Debateerige: kas raha toob õnne? Üks poolt, teine vastu.",
      "Vaielge: kas sotsiaalmeedia on hea või halb? Igaüks valib poole.",
      "Üks väidab, et linnas elamine on parem — teine, et maal. Vaidlus!",
      "Debateerige: kas ausus on ALATI parim poliitika? Valige pooled!",
      "Üks arvab, et reisimine on hariduse alus — teine, et raamatud. Veenge!",
      "Vaielge: kas AI on inimkonna jaoks hea või ohtlik?",
      "Debateerige: kas traditsioonid on olulised või peaksime neist lahti laskma?",
      "Üks väidab, et suvi on parim aastaaeg — teine, et talv. Veenge!",
      "Vaielge: kas koolis peaks olema kohustuslik vormiriietus?",
      "Debateerige: kas populaarne muusika on parem kui alternatiivne?",
      "Üks arvab, et planeerimine on oluline — teine, et spontaansus on parem. Vaidlus!",
    ],
  },
  en: {
    sync: [
      "Find 3 things you both passionately hate within 90 seconds.",
      "Name 5 movies/shows you both enjoy within 90 seconds.",
      "Find 3 foods you both love and 3 you both hate.",
      "Describe your ideal vacation to each other — find 3 similarities.",
      "Find 3 songs/artists you both like, and sing together!",
      "Name 5 things that annoy you both the most.",
      "Find 3 childhood memories that are surprisingly similar.",
      "Describe your worst date experience — find similarities!",
      "Find 3 superpowers you both would want to have.",
      "Name 5 things in your morning routine that are the same.",
      "Create a shared TOP 3 dream travel destinations.",
      "Find 3 fears you both share.",
      "Name 3 celebrities you'd both want to have dinner with.",
      "Find 3 shared weird habits you wouldn't publicly admit.",
      "Describe your ideal weekend — find at least 3 overlaps.",
    ],
    bridge: [
      "Find a topic you completely disagree on and explain each other's point of view.",
      "One must argue cats are better — the other dogs. Convince each other!",
      "Debate: is pineapple on pizza acceptable? 90 seconds!",
      "One says mornings are best — the other night owl life. Debate!",
      "Debate: does money buy happiness? One for, one against.",
      "Argue: is social media good or bad? Each pick a side.",
      "One says city life is better — the other countryside. Argue!",
      "Debate: is honesty ALWAYS the best policy? Pick sides!",
      "One says travel is the basis of education — the other says books. Convince!",
      "Argue: is AI good or dangerous for humanity?",
      "Debate: are traditions important or should we let them go?",
      "One says summer is the best season — the other winter. Convince!",
      "Argue: should schools have mandatory uniforms?",
      "Debate: is pop music better than alternative music?",
      "One says planning is key — the other that spontaneity is better. Argue!",
    ],
  },
};

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SYNC server käivitatud: http://localhost:${PORT}`);
});
