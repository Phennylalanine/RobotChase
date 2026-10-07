/* Robo Chase — shared code for host.html and index.html */
(function () {
  "use strict";

  // ───────────────────────── Data connection ─────────────────────────
  // Two interchangeable back ends with the same small API:
  //   DB.start() -> {uid, mode}
  //   DB.set(path, value) · DB.update(path, obj) · DB.get(path) · DB.remove(path)
  //   DB.on(path, callback) -> unsubscribe()
  //   DB.now() -> server-synced milliseconds · DB.TS -> "server time" placeholder
  const cfg = window.FIREBASE_CONFIG || {};
  const hasFirebase = !!(cfg.apiKey && cfg.databaseURL);
  const FB_VER = "10.12.2";

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res;
      s.onerror = () => rej(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  const FirebaseDB = {
    mode: "firebase",
    async start() {
      const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
      await loadScript(base + "firebase-app-compat.js");
      await loadScript(base + "firebase-auth-compat.js");
      await loadScript(base + "firebase-database-compat.js");
      firebase.initializeApp(cfg);
      const cred = await firebase.auth().signInAnonymously();
      this.db = firebase.database();
      this.offset = 0;
      this.db.ref(".info/serverTimeOffset").on("value", s => { this.offset = s.val() || 0; });
      this.TS = firebase.database.ServerValue.TIMESTAMP;
      return { uid: cred.user.uid, mode: this.mode };
    },
    set(p, v) { return this.db.ref(p).set(v); },
    update(p, o) { return this.db.ref(p).update(o); },
    remove(p) { return this.db.ref(p).remove(); },
    async get(p) { return (await this.db.ref(p).get()).val(); },
    on(p, cb) {
      const ref = this.db.ref(p);
      const h = ref.on("value", s => cb(s.val()));
      return () => ref.off("value", h);
    },
    now() { return Date.now() + (this.offset || 0); }
  };

  // Demo mode: a tiny look-alike database kept in localStorage, shared
  // between tabs on the same computer. Great for trying the game alone.
  const KEY = "robochase-demo-db";
  const LocalDB = {
    mode: "demo",
    TS: { ".sv": "timestamp" },
    listeners: [],
    async start() {
      window.addEventListener("storage", e => { if (e.key === KEY) this._notify(); });
      let uid = sessionStorage.getItem("rc-uid");
      if (!uid) { uid = "u" + Math.random().toString(36).slice(2, 10); sessionStorage.setItem("rc-uid", uid); }
      return { uid, mode: this.mode };
    },
    _read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
    _write(tree) {
      try { localStorage.setItem(KEY, JSON.stringify(tree)); }
      catch (e) { console.warn("Demo storage full", e); alert("Demo mode storage is full. Try smaller images."); }
      this._notify();
    },
    _parts(p) { return p.split("/").filter(Boolean); },
    _at(tree, parts) { let n = tree; for (const k of parts) { if (n == null || typeof n !== "object") return null; n = n[k]; } return n === undefined ? null : n; },
    _fill(v) {
      if (v && typeof v === "object") {
        if (v[".sv"] === "timestamp") return Date.now();
        const o = Array.isArray(v) ? [] : {};
        for (const k in v) o[k] = this._fill(v[k]);
        return o;
      }
      return v;
    },
    _put(tree, parts, v) {
      if (!parts.length) return v == null ? {} : v;
      let n = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (n[parts[i]] == null || typeof n[parts[i]] !== "object") n[parts[i]] = {};
        n = n[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (v == null) delete n[last]; else n[last] = v;
      return tree;
    },
    async set(p, v) { this._write(this._put(this._read(), this._parts(p), this._fill(v))); },
    async update(p, o) {
      let t = this._read();
      for (const k in o) t = this._put(t, this._parts(p + "/" + k), this._fill(o[k]));
      this._write(t);
    },
    async remove(p) { this.set(p, null); },
    async get(p) { return this._at(this._read(), this._parts(p)); },
    on(p, cb) {
      const l = { p, cb, last: undefined };
      this.listeners.push(l);
      setTimeout(() => this._fire(l, this._read()), 0);
      return () => { this.listeners = this.listeners.filter(x => x !== l); };
    },
    _fire(l, tree) {
      const v = this._at(tree, this._parts(l.p));
      const j = JSON.stringify(v);
      if (j !== l.last) { l.last = j; l.cb(v == null ? null : JSON.parse(j)); }
    },
    _notify() { const t = this._read(); for (const l of this.listeners.slice()) this._fire(l, t); },
    now() { return Date.now(); },
    wipe() { localStorage.removeItem(KEY); }
  };

  window.DB = hasFirebase ? FirebaseDB : LocalDB;

  // ───────────────────────── Helpers ─────────────────────────
  window.$ = (sel, root = document) => root.querySelector(sel);
  window.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  window.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  window.showScreen = id => $$(".screen").forEach(s => s.hidden = s.id !== id);

  // ───────────────────────── Game art (all original SVG) ─────────────────────────
  const CREW_COLORS = [
    ["#3DDBB0", "#1E9C7B"], ["#4AA8FF", "#2270C4"], ["#FFC93C", "#D19A0B"], ["#FF7AC6", "#CC3F8F"],
    ["#A884FF", "#6F4BD1"], ["#FF8A4C", "#D0561A"], ["#8BE04E", "#56A61E"], ["#5CE1E6", "#1FA3A9"],
    ["#F25C6E", "#B42A3C"], ["#E9EDFF", "#98A0CC"]
  ];
  const CREW_NAMES = ["Mint", "Sky", "Sunny", "Bubblegum", "Grape", "Mango", "Lime", "Aqua", "Cherry", "Moon"];
  const GEAR = ["antenna", "none", "bow", "horn"];

  // A round little space cadet. color: 0–9, gear: 0–3
  window.crewSVG = function (color = 0, gear = 0, opts = {}) {
    const [c, d] = CREW_COLORS[color % CREW_COLORS.length];
    const g = GEAR[gear % GEAR.length];
    const run = opts.run ? " crew-run" : "";
    const gearArt = {
      antenna: `<line x1="50" y1="14" x2="50" y2="2" stroke="${d}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="3" r="5" fill="#FFC93C" class="blink"/>`,
      none: "",
      bow: `<path d="M50 16 L36 6 L36 24 Z M50 16 L64 6 L64 24 Z" fill="#FF5A7A" stroke="#B42A3C" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="16" r="4" fill="#B42A3C"/>`,
      horn: `<path d="M34 22 L30 4 L42 17 Z M66 22 L70 4 L58 17 Z" fill="#FFE08A" stroke="#D19A0B" stroke-width="2" stroke-linejoin="round"/>`
    }[g];
    return `<svg class="crew${run}" viewBox="0 0 100 110" aria-hidden="true">
      <ellipse cx="50" cy="106" rx="26" ry="4" fill="rgba(0,0,0,.25)"/>
      <g class="crew-legs"><rect class="leg-a" x="33" y="84" width="12" height="18" rx="6" fill="${d}"/><rect class="leg-b" x="55" y="84" width="12" height="18" rx="6" fill="${d}"/></g>
      <rect x="22" y="58" width="56" height="36" rx="18" fill="${c}"/>
      <rect x="40" y="66" width="20" height="12" rx="4" fill="${d}"/><circle cx="46" cy="72" r="2.5" fill="#FFC93C"/><circle cx="54" cy="72" r="2.5" fill="#3DDBB0"/>
      ${gearArt}
      <circle cx="50" cy="44" r="30" fill="#F4F6FF" stroke="${d}" stroke-width="4"/>
      <rect x="28" y="30" width="44" height="30" rx="15" fill="#1B1F4B"/>
      <circle cx="41" cy="45" r="4.5" fill="#fff"/><circle cx="59" cy="45" r="4.5" fill="#fff"/>
      <path d="M44 53 Q50 57 56 53" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M33 36 Q38 31 46 32" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>
    </svg>`;
  };
  window.CREW_COUNT = CREW_COLORS.length;
  window.GEAR_COUNT = GEAR.length;
  window.CREW_NAMES = CREW_NAMES;

  // The chaser: a boxy station-security bot with one angry eye.
  window.robotSVG = function (opts = {}) {
    const run = opts.run ? " robot-run" : "";
    return `<svg class="robot${run}" viewBox="0 0 140 160" aria-hidden="true">
      <ellipse cx="70" cy="155" rx="44" ry="5" fill="rgba(0,0,0,.3)"/>
      <g class="robot-legs">
        <rect class="leg-a" x="42" y="118" width="18" height="32" rx="5" fill="#5B648F"/>
        <rect class="leg-b" x="80" y="118" width="18" height="32" rx="5" fill="#5B648F"/>
        <rect x="36" y="144" width="30" height="10" rx="4" fill="#3A4170"/><rect x="74" y="144" width="30" height="10" rx="4" fill="#3A4170"/>
      </g>
      <g class="robot-arm-l"><rect x="6" y="66" width="18" height="44" rx="8" fill="#8C95C9"/><path d="M4 110 h22 l-4 14 h-4 l-3 -8 l-3 8 h-4 Z" fill="#3A4170"/></g>
      <g class="robot-arm-r"><rect x="116" y="66" width="18" height="44" rx="8" fill="#8C95C9"/><path d="M114 110 h22 l-4 14 h-4 l-3 -8 l-3 8 h-4 Z" fill="#3A4170"/></g>
      <rect x="22" y="58" width="96" height="66" rx="12" fill="#A9B1DE"/>
      <g clip-path="url(#hz)"><clipPath id="hz"><rect x="22" y="100" width="96" height="14"/></clipPath>
        <rect x="22" y="100" width="96" height="14" fill="#FFC93C"/>
        ${[0,1,2,3,4,5,6].map(i => `<path d="M${14 + i*18} 114 l14 -14 h9 l-14 14 Z" fill="#1B1F4B"/>`).join("")}
      </g>
      <line x1="70" y1="8" x2="70" y2="22" stroke="#5B648F" stroke-width="5"/>
      <circle cx="70" cy="7" r="6" fill="#FF5A5F" class="blink"/>
      <rect x="30" y="18" width="80" height="46" rx="14" fill="#8C95C9"/>
      <rect x="40" y="28" width="60" height="26" rx="13" fill="#1B1F4B"/>
      <circle cx="70" cy="41" r="10" fill="#FF5A5F" class="robot-eye"/><circle cx="73" cy="38" r="3" fill="#FFD1D2"/>
      <path d="M44 26 L62 32 M96 26 L78 32" stroke="#1B1F4B" stroke-width="5" stroke-linecap="round"/>
      <rect x="50" y="72" width="40" height="18" rx="4" fill="#5B648F"/>
      <circle cx="58" cy="81" r="3" fill="#3DDBB0"/><circle cx="70" cy="81" r="3" fill="#FFC93C"/><circle cx="82" cy="81" r="3" fill="#FF5A5F" class="blink"/>
    </svg>`;
  };

  window.podSVG = function (cls = "") {
    return `<svg class="pod ${cls}" viewBox="0 0 120 150" aria-hidden="true">
      <path d="M60 6 C92 30 100 70 96 118 H24 C20 70 28 30 60 6 Z" fill="#E9EDFF" stroke="#98A0CC" stroke-width="4"/>
      <circle cx="60" cy="60" r="18" fill="#4AA8FF" stroke="#2270C4" stroke-width="5"/>
      <circle cx="54" cy="54" r="5" fill="#fff" opacity=".7"/>
      <path d="M24 100 L6 132 H30 Z M96 100 L114 132 H90 Z" fill="#FF5A5F"/>
      <rect x="44" y="118" width="32" height="10" rx="3" fill="#5B648F"/>
      <path class="flame" d="M48 128 Q60 158 72 128 Z" fill="#FFC93C"/>
    </svg>`;
  };

  // Things the crew picks up along the track in chapters 2 and 3.
  const ITEMS = {
    gear: `<circle cx="30" cy="30" r="17" fill="#A9B1DE" stroke="#5B648F" stroke-width="3"/>${[0,45,90,135,180,225,270,315].map(a => `<rect x="25" y="4" width="10" height="12" rx="2" fill="#A9B1DE" stroke="#5B648F" stroke-width="2" transform="rotate(${a} 30 30)"/>`).join("")}<circle cx="30" cy="30" r="7" fill="#5B648F"/>`,
    wrench: `<path d="M14 46 L36 24 A10 10 0 1 1 44 16 L40 22 L44 26 L50 22 A10 10 0 0 1 38 32 L18 52 A4 4 0 0 1 12 46 Z" fill="#FFC93C" stroke="#B98A00" stroke-width="3" stroke-linejoin="round"/>`,
    battery: `<rect x="12" y="16" width="34" height="34" rx="5" fill="#3DDBB0" stroke="#1E9C7B" stroke-width="3"/><rect x="22" y="9" width="14" height="8" rx="2" fill="#1E9C7B"/><path d="M32 22 L24 34 H30 L27 44 L36 31 H30 Z" fill="#fff"/>`,
    nut: `<path d="M30 8 L49 19 V41 L30 52 L11 41 V19 Z" fill="#FF8A4C" stroke="#D0561A" stroke-width="3" stroke-linejoin="round"/><circle cx="30" cy="30" r="9" fill="#1B1F4B"/>`,
    chip: `<rect x="14" y="14" width="32" height="32" rx="4" fill="#4AA8FF" stroke="#2270C4" stroke-width="3"/>${[20,30,40].map(v => `<rect x="${v-2}" y="6" width="4" height="8" fill="#98A0CC"/><rect x="${v-2}" y="46" width="4" height="8" fill="#98A0CC"/><rect x="6" y="${v-2}" width="8" height="4" fill="#98A0CC"/><rect x="46" y="${v-2}" width="8" height="4" fill="#98A0CC"/>`).join("")}<rect x="22" y="22" width="16" height="16" rx="2" fill="#1B1F4B"/>`,
    fuel: `<rect x="17" y="8" width="26" height="46" rx="10" fill="#8BE04E" stroke="#56A61E" stroke-width="3"/><rect x="24" y="3" width="12" height="7" rx="2" fill="#56A61E"/><rect x="23" y="18" width="14" height="26" rx="5" fill="#D9FFB8" class="glow"/>`
  };
  window.itemSVG = k => `<svg class="item" viewBox="0 0 60 60" aria-hidden="true">${ITEMS[k]}</svg>`;

  // ───────────────────────── The story ─────────────────────────
  // Each chapter is one self-paced chase followed by one bonus game.
  window.CHAPTERS = [
    {
      key: "station", title: "Chapter 1: Escape the space station!",
      goal: "Everyone get 5 right to reach the escape pods!",
      items: null, itemLabel: "",
      done: "Everyone got 5! To the escape pods!",
      wait: ["Everyone got 5!", "The crew is diving into the escape pods. Get ready to fly!"]
    },
    {
      key: "planet", title: "Chapter 2: Crash landing!",
      goal: "Everyone get 5 right to collect the parts and fix the pod!",
      items: ["gear", "wrench", "battery", "nut", "chip"], itemLabel: "Parts",
      done: "All parts collected! Pod fixed, blast off!",
      wait: ["Pod fixed!", "Blasting off into space. Get ready to fly!"],
      scene: "crash", sceneText: ["Crash landing!", "The pod smashed into a strange planet and the robot followed us down. Collect the parts to fix the pod!"]
    },
    {
      key: "moon", title: "Chapter 3: Out of fuel!",
      goal: "Everyone get 5 right to fill the fuel tanks!",
      items: ["fuel", "fuel", "fuel", "fuel", "fuel"], itemLabel: "Fuel",
      done: "Fuel tanks full! Blast off for home!",
      wait: ["Tanks full!", "Blasting off for home. One last bonus round!"],
      scene: "fuel", sceneText: ["Out of fuel!", "The engine sputtered and we drifted down onto an icy moon. Grab the fuel cells before the robot catches us!"]
    }
  ];
  window.ENDING = ["We made it home!", "The crew flew all the way home, and the robot drifted off into deep space."];

  // Answer tile icons (space themed). Up to 6 answers.
  const ICONS = [
    `<path d="M50 8 L61 38 L93 38 L67 57 L77 89 L50 70 L23 89 L33 57 L7 38 L39 38 Z"/>`,                                     // star
    `<path d="M62 10 A40 40 0 1 0 90 66 A32 32 0 1 1 62 10 Z"/>`,                                                           // moon
    `<circle cx="50" cy="50" r="24"/><ellipse cx="50" cy="52" rx="44" ry="12" fill="none" stroke="currentColor" stroke-width="7" transform="rotate(-18 50 50)"/>`, // planet
    `<path d="M58 6 L20 56 H46 L38 94 L80 40 H54 Z"/>`,                                                                      // bolt
    `<circle cx="66" cy="34" r="20"/><path d="M52 48 L10 90 M58 54 L28 88 M46 42 L14 70" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>`, // comet
    `<path d="M50 88 C18 64 6 46 16 28 C26 12 44 16 50 30 C56 16 74 12 84 28 C94 46 82 64 50 88 Z"/>`                        // heart
  ];
  window.ANSWER_COLORS = ["#20B98F", "#2F8EEA", "#E8A800", "#E5489E", "#8A63F0", "#F06A2A"];
  window.answerIcon = i => `<svg class="ans-icon" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${ICONS[i % ICONS.length]}</svg>`;

  // ───────────────────────── Race rules ─────────────────────────
  // Self-paced chase: every student needs GOAL correct answers. The crew's
  // position is the class's average progress toward that goal, so the crew
  // only reaches the escape pods when everyone has their 5. The robot walks
  // forward with time. Catches use up a shield, then cost a life.
  window.RACE = {
    GOAL: 5,
    start() { return { crew: 15, robot: 0, shields: 3, leg: 1, escapes: 0, lives: 0, maxLives: 0, done: 0, total: 0 }; },
    newLeg(r) { return { ...r, crew: 15, robot: 0, shields: 3, leg: r.leg + 1, done: 0 }; },
    // seconds the robot takes to cross the track: enough for a steady class, tight for a slow one
    legTime(questions) {
      const avg = questions.reduce((a, q) => a + q.time, 0) / Math.max(1, questions.length);
      return this.GOAL / 0.6 * (avg * 0.45 + 2.5) * 1.6;
    }
  };

  // Crew art as an <img> for drawing on a canvas (cached).
  const imgCache = {};
  window.crewImage = function (color = 0, gear = 0) {
    const k = color + "-" + gear;
    if (!imgCache[k]) {
      const svg = crewSVG(color, gear).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      imgCache[k] = img;
    }
    return imgCache[k];
  };

  // Downscale an image file to a small JPEG data URL so it syncs quickly.
  window.shrinkImage = function (file, max = 900, quality = 0.72) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const cx = cv.getContext("2d");
        cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        res(cv.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Not an image: " + file.name)); };
      img.src = url;
    });
  };

  window.showModeBanner = function () {
    if (DB.mode !== "demo") return;
    const b = document.createElement("div");
    b.className = "demo-banner";
    b.innerHTML = `Demo mode: works only in tabs on this computer. Add your Firebase settings to play with students (see README).`;
    document.body.appendChild(b);
    document.body.classList.add("has-banner");
  };
})();
