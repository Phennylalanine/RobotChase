/* Robo Chase — teacher / host screen */
(async function () {
  "use strict";

  let me, code = null, quiz = null, race = null;
  let players = {}, scores = {}, unsubs = [], timerId = null, botTimers = [];
  let bonusTimers = [], bonusRaf = 0;
  let imageTargetIndex = null;
  const room = p => `rooms/${code}${p ? "/" + p : ""}`;

  $("#brandBot").innerHTML = robotSVG();

  // ─────────────── Sound (tiny, generated) ───────────────
  let muted = false, actx = null;
  function beep(freq, dur = .12, type = "square", vol = .06, when = 0) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, actx.currentTime + when);
      g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + when + dur);
      o.connect(g).connect(actx.destination);
      o.start(actx.currentTime + when); o.stop(actx.currentTime + when + dur + .02);
    } catch {}
  }
  const sfx = {
    join: () => { beep(660, .08, "triangle"); beep(990, .1, "triangle", .06, .07); },
    tick: () => beep(880, .05, "square", .04),
    reveal: () => [523, 659, 784].forEach((f, i) => beep(f, .15, "triangle", .07, i * .09)),
    alarm: () => [0, .25, .5].forEach(t => { beep(300, .2, "sawtooth", .05, t); beep(220, .2, "sawtooth", .05, t + .12); }),
    win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => beep(f, .18, "triangle", .08, i * .12))
  };
  $("#muteBtn").onclick = e => {
    muted = !muted;
    e.currentTarget.textContent = muted ? "🔇" : "🔊";
    e.currentTarget.setAttribute("aria-pressed", muted);
  };

  // ─────────────── Saved quiz (this browser) ───────────────
  const idb = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("robochase", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async put(k, v) { try { const db = await this.open(); db.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch {} },
    async get(k) {
      try {
        const db = await this.open();
        return await new Promise(res => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
      } catch { return null; }
    }
  };
  const saveQuiz = () => idb.put("quiz", quiz);

  // ─────────────── Reading quiz files ───────────────
  function decodeText(buf) {
    let t;
    try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch { t = new TextDecoder("shift_jis").decode(buf); }   // Excel "CSV" on Japanese Windows
    return t.replace(/^\uFEFF/, "");
  }

  async function loadXlsxLib() {
    if (window.XLSX) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "lib/xlsx.mini.min.js"; s.onload = res; s.onerror = () => rej(new Error("Could not load the Excel reader."));
      document.head.appendChild(s);
    });
  }

  function rowsToQuiz(rows) {
    const norm = s => String(s ?? "").trim();
    const hi = rows.findIndex(r => r.some(c => /^question/i.test(norm(c))));
    if (hi < 0) throw new Error('Couldn\'t find a header row. The first column heading should be "Question".');
    const head = rows[hi].map(norm);
    const col = {
      q: head.findIndex(h => /^question/i.test(h)),
      answers: head.map((h, i) => /^answer\s*\d/i.test(h) ? i : -1).filter(i => i >= 0),
      time: head.findIndex(h => /time/i.test(h)),
      correct: head.findIndex(h => /correct/i.test(h)),
      image: head.findIndex(h => /image|picture|photo|画像/i.test(h))
    };
    if (col.answers.length < 2) throw new Error('Need at least two answer columns ("Answer 1", "Answer 2").');
    if (col.correct < 0) throw new Error('Missing the "Correct answer(s)" column.');

    const questions = [], problems = [];
    rows.slice(hi + 1).forEach((r, k) => {
      const text = norm(r[col.q]);
      const raw = col.answers.map(i => norm(r[i]));
      if (!text && raw.every(a => !a)) return;
      const keep = raw.map((a, i) => ({ a, n: i + 1 })).filter(x => x.a !== "");
      const nums = (norm(r[col.correct]).match(/\d+/g) || []).map(Number);
      const correct = keep.map((x, i) => nums.includes(x.n) ? i : -1).filter(i => i >= 0);
      let time = parseInt(norm(r[col.time]), 10);
      if (!(time > 0)) time = 20;
      time = Math.max(5, Math.min(240, time));
      const line = hi + k + 2;
      if (keep.length < 2) { problems.push(`Row ${line}: needs at least two answers.`); return; }
      if (!correct.length) { problems.push(`Row ${line}: correct answer number doesn't match an answer.`); return; }
      questions.push({
        text: text || "?", answers: keep.map(x => x.a), time, correct,
        imageName: col.image >= 0 ? norm(r[col.image]) : "", image: null
      });
    });
    if (!questions.length) throw new Error(problems[0] || "No questions found in the file.");
    return { questions, problems };
  }

  async function readQuizFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".json")) {
      const pack = JSON.parse(await file.text());
      if (!pack || !Array.isArray(pack.questions)) throw new Error("That file isn't a saved Robo Chase quiz.");
      return { quiz: pack, problems: [] };
    }
    let rows;
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      await loadXlsxLib();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false });
    } else {
      const text = decodeText(await file.arrayBuffer());
      rows = Papa.parse(text, { skipEmptyLines: true }).data;
    }
    const { questions, problems } = rowsToQuiz(rows);
    return { quiz: { title: file.name.replace(/\.[^.]+$/, ""), questions }, problems };
  }

  const baseName = s => String(s || "").toLowerCase().replace(/\.[^.]+$/, "").replace(/[\s_\-]+/g, " ").trim();

  async function attachImages(files) {
    if (!quiz) { showErr("Add the quiz file first, then the pictures."); return; }
    const imgs = files.filter(f => f.type.startsWith("image/")).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const leftover = [];
    let byName = 0, inOrder = 0;
    for (const f of imgs) {
      const b = baseName(f.name);
      const q = quiz.questions.find(q => !q.image && ((q.imageName && baseName(q.imageName) === b) || baseName(q.text) === b));
      if (q) { q.image = await shrinkImage(f); q.imageName = f.name; byName++; }
      else leftover.push(f);
    }
    for (const f of leftover) {
      const q = quiz.questions.find(q => !q.image);
      if (!q) break;
      q.image = await shrinkImage(f); q.imageName = f.name; inOrder++;
    }
    const skipped = imgs.length - byName - inOrder;
    showErr(inOrder || skipped ? `${byName} picture(s) matched by name, ${inOrder} added in order${skipped ? `, ${skipped} not used (every question already has one)` : ""}. Check the list and change any that landed on the wrong question.` : "", true);
    saveQuiz(); renderQuizList();
  }

  function showErr(msg, soft) {
    const el = $("#loadErr");
    el.hidden = !msg; el.textContent = msg || "";
    el.style.color = soft ? "var(--muted)" : "";
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    const quizFile = files.find(f => /\.(csv|tsv|txt|xlsx|xls|json)$/i.test(f.name));
    const images = files.filter(f => f.type.startsWith("image/"));
    showErr("");
    try {
      if (quizFile) {
        const { quiz: q, problems } = await readQuizFile(quizFile);
        quiz = q;
        if (problems.length) showErr(`Skipped ${problems.length} row(s). ${problems.slice(0, 3).join(" ")}`);
      }
      if (images.length) await attachImages(images);
      if (!quizFile && !images.length) showErr("That file type isn't supported. Use CSV, Excel (.xlsx) or pictures.");
      saveQuiz(); renderQuizList();
    } catch (e) { showErr(e.message); }
  }

  // ─────────────── Quiz list UI ───────────────
  function renderQuizList() {
    $("#qpanel").hidden = !quiz;
    if (!quiz) return;
    $("#quizTitle").value = quiz.title || "";
    $("#qcount").textContent = `${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"}`;
    $("#qlist").innerHTML = quiz.questions.map((q, i) => `
      <li class="qitem">
        <span class="num">${i + 1}</span>
        <button class="thumb ${q.image ? "has" : ""}" data-pic="${i}" style="${q.image ? `background-image:url('${q.image}')` : ""}" title="${q.image ? "Change picture" : "Add picture"}">${q.image ? "" : "+ picture"}</button>
        <div>
          <div class="qtext">${esc(q.text)}</div>
          <div class="qmeta">${q.answers.map((a, k) => q.correct.includes(k) ? `<b>${esc(a)} ✓</b>` : esc(a)).join(" / ")} · ${q.time}s</div>
        </div>
        <div class="qbtns">
          ${q.image ? `<button class="chip warn" data-unpic="${i}">Remove picture</button>` : ""}
        </div>
      </li>`).join("");
  }

  $("#qlist").addEventListener("click", e => {
    const pic = e.target.closest("[data-pic]"), un = e.target.closest("[data-unpic]");
    if (pic) { imageTargetIndex = +pic.dataset.pic; $("#oneImage").click(); }
    if (un) { quiz.questions[+un.dataset.unpic].image = null; saveQuiz(); renderQuizList(); }
  });
  $("#oneImage").onchange = async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || imageTargetIndex == null) return;
    try { quiz.questions[imageTargetIndex].image = await shrinkImage(f); quiz.questions[imageTargetIndex].imageName = f.name; saveQuiz(); renderQuizList(); }
    catch (err) { showErr(err.message); }
  };
  $("#quizTitle").oninput = e => { quiz.title = e.target.value; saveQuiz(); };
  $("#pickQuiz").onclick = () => $("#quizFile").click();
  $("#pickImages").onclick = () => $("#imageFiles").click();
  $("#quizFile").onchange = e => { handleFiles(e.target.files); e.target.value = ""; };
  $("#imageFiles").onchange = e => { handleFiles(e.target.files); e.target.value = ""; };
  $("#clearQuiz").onclick = () => { if (confirm("Remove this quiz from the list?")) { quiz = null; idb.put("quiz", null); renderQuizList(); } };
  $("#savePack").onclick = () => {
    const blob = new Blob([JSON.stringify(quiz)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (quiz.title || "quiz").replace(/[^\w\- ]+/g, "") + ".robochase.json";
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#useSample").onclick = () => {
    const csv = "Question,Answer 1,Answer 2,Answer 3,Answer 4,Time limit (sec),Correct answer(s)\n" +
      "Which one is a fruit?,Carrot,Apple,Bread,Milk,20,2\n" +
      "How many legs does a spider have?,6,8,10,4,20,2\n" +
      "The sun is a star.,True,False,,,15,1\n" +
      "Pick the even numbers,3,4,7,10,20,\"2,4\"\n" +
      "What color do you get by mixing blue and yellow?,Green,Purple,Orange,Red,20,1";
    quiz = { title: "Sample quiz", questions: rowsToQuiz(Papa.parse(csv).data).questions };
    showErr(""); saveQuiz(); renderQuizList();
  };

  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === "drop" || !e.relatedTarget) drop.classList.remove("over"); }));
  document.addEventListener("drop", e => { if (!$("#setup").hidden && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  // ─────────────── Connect ───────────────
  try { me = await DB.start(); }
  catch (e) { showErr("Couldn't connect to Firebase: " + e.message + " Check firebase-config.js."); return; }
  showModeBanner();
  quiz = await idb.get("quiz");
  renderQuizList();
  showScreen("setup");

  // ─────────────── Room & lobby ───────────────
  const joinURL = () => new URL("./", location.href).href.replace(/\/$/, "/");

  $("#openRoom").onclick = async () => {
    if (!quiz || !quiz.questions.length) return;
    $("#openRoom").disabled = true;
    try {
      if (DB.mode === "demo") DB.wipe();
      for (let tries = 0; tries < 10; tries++) {
        const c = String(Math.floor(100000 + Math.random() * 900000));
        if (!(await DB.get(`rooms/${c}/host`))) { code = c; break; }
      }
      race = RACE.start();
      await DB.set(room(), {
        host: me.uid, createdAt: DB.TS, title: quiz.title || "", total: quiz.questions.length,
        state: { phase: "lobby" }, race
      });
      openLobby();
    } catch (e) { alert("Couldn't open a room: " + e.message); }
    $("#openRoom").disabled = false;
  };

  function openLobby() {
    players = {}; scores = {};
    $("#roomCode").textContent = code;
    const url = joinURL();
    $("#joinUrl").textContent = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    try {
      const qr = qrcode(0, "M"); qr.addData(url + "?code=" + code); qr.make();
      $("#qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch { $("#qr").innerHTML = ""; }
    unsubs.forEach(u => u()); unsubs = [];
    let known = new Set();
    unsubs.push(DB.on(room("players"), v => {
      players = v || {};
      const ids = Object.keys(players);
      const fresh = ids.filter(id => !known.has(id));
      if (fresh.length) sfx.join();
      known = new Set(ids);
      renderLobby(new Set(fresh));
    }));
    showScreen("lobby");
  }

  function renderPlan() {
    const mins = +$("#gameMins").value || 20;
    const per = RACE.sectionSecs(1, mins * 60);
    $("#planHint").textContent = `≈ ${Math.round(per / 6) / 10} min of quiz per chapter`;
  }
  $("#gameMins").onchange = renderPlan;
  renderPlan();

  function renderLobby(fresh = new Set()) {
    const ids = Object.keys(players).sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0));
    $("#playerCount").textContent = `${ids.length} player${ids.length === 1 ? "" : "s"}`;
    $("#startGame").disabled = !ids.length;
    $("#lobbyFloor").innerHTML = ids.length
      ? ids.map(id => `<button class="player-tag link-btn ${fresh.has(id) ? "fresh" : ""}" data-kick="${id}" title="Click to remove ${esc(players[id].name)}" style="text-decoration:none;color:inherit">
          ${crewSVG(players[id].color, players[id].gear)}<span>${esc(players[id].name)}</span></button>`).join("")
      : `<div class="lobby-empty">${robotSVG()}Waiting for the crew to board…</div>`;
  }
  $("#lobbyFloor").addEventListener("click", e => {
    const k = e.target.closest("[data-kick]");
    if (k && confirm(`Remove ${players[k.dataset.kick]?.name || "this player"} from the game?`)) DB.remove(room("players/" + k.dataset.kick));
  });

  const BOT_NAMES = ["Beep", "Zippy", "Nova", "Bolt", "Pixel", "Comet", "Orbit", "Sprocket", "Luna", "Gizmo"];
  $("#addBots").onclick = async () => {
    const upd = {};
    for (let i = 0; i < 5; i++) {
      const id = "bot" + Math.random().toString(36).slice(2, 8);
      upd[id] = { name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + " (test)", color: Math.floor(Math.random() * CREW_COUNT), gear: Math.floor(Math.random() * GEAR_COUNT), joinedAt: DB.now(), bot: true };
    }
    await DB.update(room("players"), upd);
  };

  $("#backToSetup").onclick = async () => { unsubs.forEach(u => u()); unsubs = []; await DB.remove(room()); code = null; showScreen("setup"); };

  // ─────────────── Self-paced, timed chase ───────────────
  // Questions go to every device; students answer at their own pace and this
  // screen marks each answer. Each quiz section runs for a planned time (from
  // the teacher's game length); correct answers keep the robot back.
  let processed = {}, lastTick = 0, playing = false, tickCount = 0, packKey = "";
  let gameDeadline = 0, secStart = 0, secLen = 0, pendingBoost = 0;
  const newScore = () => ({ score: 0, streak: 0, leg: 0, answered: 0, right: 0 });

  // Stop every running timer and loop; keep only the players listener.
  function clearTimers() {
    clearInterval(timerId); timerId = null;
    botTimers.forEach(clearTimeout); botTimers = [];
    bonusTimers.forEach(clearTimeout); bonusTimers = [];
    cancelAnimationFrame(bonusRaf); bonusRaf = 0;
    unsubs.slice(1).forEach(u => u()); unsubs = unsubs.slice(0, 1);
  }

  $("#startGame").onclick = async () => {
    const ids = Object.keys(players);
    const per = +$("#livesPer").value || 1;
    gameDeadline = DB.now() + (+$("#gameMins").value || 20) * 60000;
    race = { ...RACE.start(), lives: ids.length * per, maxLives: ids.length * per };
    scores = {}; processed = {};
    ids.forEach(id => scores[id] = newScore());
    // students get the questions without the answers; pictures are fetched one at a time
    const qs = quiz.questions.map(q => ({ text: q.text, answers: q.answers, time: q.time, img: !!q.image }));
    const imgs = {};
    quiz.questions.forEach((q, i) => { if (q.image) imgs["i" + i] = q.image; });
    await DB.update(room(), { quiz: { q: qs }, quizimg: imgs, scores, subs: null, results: null, race });
    startChase();
  };

  async function startChase() {
    clearTimers();
    // share out the time that's left between this chapter and the ones after it
    secLen = RACE.sectionSecs(race.leg, (gameDeadline - DB.now()) / 1000);
    secStart = DB.now();
    race.secLen = secLen; race.endsAt = secStart + secLen * 1000; race.gap = RACE.START_GAP;
    pendingBoost = 0;
    lastTick = DB.now(); tickCount = 0; packKey = ""; shieldsBefore = race.shields;
    playing = true;
    $("#pCode").textContent = code;
    $("#raceBanner").hidden = true;
    const ch = chapter();
    $("#pGoal").textContent = ch.goal;
    $("#pChapter").textContent = ch.title;
    $("#track").className = "track-wrap live ch-" + ch.key;
    $("#podRunner").innerHTML = podSVG(ch.key === "planet" ? "broken" : ch.key === "moon" ? "empty" : "") +
      (ch.key === "planet" ? `<div class="pod-smoke"><i></i><i></i><i></i></div>` : "");
    // undo the previous chapter's boarding and launch animations
    ["#podRunner", "#crewRunner"].forEach(sel => { $(sel).style.opacity = ""; $(sel).style.transform = ""; });
    $("#botRunner").innerHTML = robotSVG({ run: true });
    $("#items").innerHTML = (ch.items || []).map(k => itemSVG(k)).join("");
    $("#partsHud").hidden = !ch.items;
    $("#partsHud").innerHTML = ch.items ? `${ch.itemLabel} ${ch.items.map(k => itemSVG(k)).join("")}` : "";
    showScreen("play");
    await DB.update(room(), { state: { phase: "play", leg: race.leg, chapter: ch.key }, race });
    unsubs.push(DB.on(room("subs"), v => grade(v || {})));
    timerId = setInterval(tickChase, 500);
    tickChase();
    startBots();
  }

  function grade(subs) {
    if (!playing) return;
    const upd = {};
    for (const [id, s] of Object.entries(subs)) {
      if (!players[id] || !s || typeof s.n !== "number" || s.n <= (processed[id] ?? -1)) continue;
      processed[id] = s.n;
      const q = quiz.questions[s.q];
      if (!q) continue;
      const sc = scores[id] || (scores[id] = newScore());
      const ok = s.choice >= 0 && q.correct.includes(s.choice);
      const frac = Math.min(1, Math.max(0, ((s.at || 0) - (s.shownAt || 0)) / (q.time * 1000)));
      const gained = ok ? Math.round(500 + 500 * (1 - frac)) + Math.min(sc.streak, 3) * 50 : 0;
      sc.answered++;
      if (ok) { sc.right++; sc.leg++; sc.streak++; pendingBoost += RACE.boost(Object.keys(players).length, quiz.questions); } else sc.streak = 0;
      sc.score += gained;
      const items = chapter().items;
      upd["results/" + id] = { n: s.n, correct: ok, right: q.correct, gained, item: ok && items ? items[(sc.leg - 1) % items.length] : null };
      upd["scores/" + id] = sc;
    }
    if (Object.keys(upd).length) DB.update(room(), upd);
    renderBoard();
  }

  function tickChase() {
    if (!playing) return;
    const now = DB.now(), dt = (now - lastTick) / 1000;
    lastTick = now;
    const f = Math.min(1, (now - secStart) / (secLen * 1000));
    race.crew = 15 + 85 * f;                                   // the clock carries the crew to the pods
    race.gap = Math.min(RACE.MAX_GAP, race.gap - RACE.DRIFT * dt + pendingBoost);
    pendingBoost = 0;
    let caught = false;
    if (race.gap <= 0 && f < 1) {
      caught = true;
      if (race.shields > 0) race.shields--; else race.lives = Math.max(0, race.lives - 1);
      race.gap = RACE.RESET_GAP;
    }
    race.robot = Math.max(0, race.crew - Math.max(0, race.gap));
    renderTrack(caught);
    if (++tickCount % 2 === 0 || caught) DB.set(room("race"), race);
    if (race.lives <= 0) { playing = false; return setTimeout(() => endGame(true), 2500); }
    if (f >= 1) reachPods();
  }

  async function reachPods() {
    if (!playing) return;
    playing = false;
    clearTimers();
    race.crew = 100;
    renderTrack(false);
    const ch = chapter();
    const b = $("#raceBanner");
    b.hidden = false; b.className = "race-banner good"; b.textContent = ch.done;
    sfx.win();
    await DB.update(room(), { race, state: { phase: "pod", leg: race.leg, title: ch.wait[0], sub: ch.wait[1] } });
    // the crew climbs in, the pod is fixed / fuelled, and it launches
    const podEl = $("#podRunner"), crewEl = $("#crewRunner");
    setTimeout(() => {
      crewEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700 });
      crewEl.style.opacity = "0";
      podEl.innerHTML = podSVG();
    }, 1200);
    setTimeout(() => {
      podEl.animate([{ transform: "translateY(0)" }, { transform: "translateY(10px)", offset: .15 }, { transform: "translateY(-420px)" }],
        { duration: 1600, easing: "cubic-bezier(.5,0,.9,.4)" });
      podEl.style.transform = "translateY(-420px)";
    }, 2200);
    setTimeout(startBonus, 4200);
  }
  $("#pForce").onclick = () => { if (playing && confirm("End this quiz section now and start the bonus round?")) reachPods(); };
  $("#pEnd").onclick = () => { if (confirm("End the game and show the results?")) { playing = false; endGame(); } };

  // ── chase drawing ──
  const chapter = () => CHAPTERS[Math.min(CHAPTERS.length, race.leg) - 1];
  // item k is reached when the class is (k+1)/n of the way to everyone having 5
  const itemSpot = (k, n) => 15 + 85 * (k + 1) / n - 2;
  let packW = 300;
  const pos = v => `calc((100% - ${packW + 90}px) * ${Math.max(0, Math.min(100, v)) / 100} + 40px)`;

  function renderTrack(caught) {
    const ids = Object.keys(players);
    const shown = ids.slice(0, 8);
    const key = shown.join() + "|" + ids.length;
    const crew = $("#crewRunner"), bot = $("#botRunner");
    if (key !== packKey) {
      packKey = key;
      crew.innerHTML = shown.map(id => crewSVG(players[id].color, players[id].gear, { run: true })).join("") +
        (ids.length > shown.length ? `<span class="more">+${ids.length - shown.length}</span>` : "");
      packW = crew.offsetWidth || 300;
    }
    crew.style.left = pos(race.crew);
    bot.style.left = pos(race.robot);
    const items = $$("#items .item"), hud = $$("#partsHud .item");
    items.forEach((el, k) => {
      const v = itemSpot(k, items.length);
      el.style.left = `calc(${pos(v)} + ${packW}px)`;
      const got = race.crew >= v - 0.5;
      if (got && !el.classList.contains("got")) sfx.join();
      el.classList.toggle("got", got);
      if (hud[k]) hud[k].classList.toggle("have", got);
    });
    $("#shields").innerHTML = [0, 1, 2].map(k => `<i class="${k < race.shields ? "" : "gone"}" title="Shield"></i>`).join("");
    $("#livesTag").innerHTML = `❤ <b>${race.lives}</b>`;
    $("#pTimer").textContent = fmtTime((race.endsAt - DB.now()) / 1000);
    if (caught) {
      sfx.alarm();
      const z = $("#zap"); z.classList.remove("on"); void z.offsetWidth; z.classList.add("on");
      const b = $("#raceBanner");
      b.hidden = false; b.className = "race-banner bad";
      b.textContent = caughtText();
      clearTimeout(renderTrack.t);
      renderTrack.t = setTimeout(() => { if (playing) b.hidden = true; }, 3000);
    }
  }
  let shieldsBefore = 3;
  function caughtText() {
    const usedShield = race.shields < shieldsBefore;
    shieldsBefore = race.shields;
    return usedShield ? "The robot grabbed us! A shield saved the crew." : "The robot grabbed us! −1 life";
  }

  function renderBoard() {
    const right = id => scores[id]?.leg || 0;
    const ids = Object.keys(players).sort((a, b) => right(a) - right(b) || (players[a].name || "").localeCompare(players[b].name || ""));
    $("#pBoard").innerHTML = ids.map(id => `<button class="crew-card" data-kick="${id}" title="Click to remove ${esc(players[id].name)}">
        ${crewSVG(players[id].color, players[id].gear)}<span class="nm">${esc(players[id].name)}</span><b class="nright">${right(id)}</b></button>`).join("");
  }
  $("#pBoard").addEventListener("click", e => {
    const k = e.target.closest("[data-kick]");
    if (k && confirm(`Remove ${players[k.dataset.kick]?.name || "this player"} from the game?`)) {
      DB.remove(room("players/" + k.dataset.kick));
      DB.remove(room("scores/" + k.dataset.kick));
    }
  });

  // Test players answer on their own every few seconds (about 70% right).
  function startBots() {
    for (const id of Object.keys(players).filter(id => players[id].bot)) {
      let n = (processed[id] ?? -1) + 1;
      const go = () => {
        if (!playing || !players[id]) return;
        const qi = Math.floor(Math.random() * quiz.questions.length), q = quiz.questions[qi];
        const wrong = q.answers.map((_, k) => k).filter(k => !q.correct.includes(k));
        const choice = Math.random() < .7 || !wrong.length ? q.correct[0] : wrong[Math.floor(Math.random() * wrong.length)];
        const shownAt = DB.now() - 2000 - Math.random() * 4000;
        DB.set(room("subs/" + id), { n: n++, q: qi, choice, shownAt, at: DB.now() });
        botTimers.push(setTimeout(go, 2500 + Math.random() * 4500));
      };
      botTimers.push(setTimeout(go, 1500 + Math.random() * 3000));
    }
  }

  // ─────────────── Bonus: Missile Dodge ───────────────
  // Every student flies their own pod on their device. A green safe zone
  // appears, missiles hit everything outside it. Anyone caught outside costs
  // the crew a life and sits out until the next question.
  let bonus = null, out = {}, podPos = {}, podShow = {}, bots = {}, hitShow = {}, bonusSeed = 0;
  const bonusTimer = (fn, ms) => bonusTimers.push(setTimeout(fn, ms));
  const activeIds = () => Object.keys(players).filter(id => !out[id]);

  async function startBonus() {
    clearTimers();
    out = {}; podPos = {}; podShow = {}; hitShow = {}; bots = {};
    bonusSeed = Math.floor(Math.random() * 1e9);
    rounds = BONUS.roundsFor(race.leg);
    $("#bDone").hidden = true;
    $("#bBanner").hidden = true;
    showScreen("bonus");
    bonusScale = BONUS.fit($("#bArena"));
    await DB.update(room(), { bonusOut: null, pos: null, safe: null, bonus: null });
    unsubs.push(DB.on(room("pos"), v => { podPos = v || {}; }));
    const loop = () => { drawBonus(); bonusRaf = requestAnimationFrame(loop); };
    bonusRaf = requestAnimationFrame(loop);
    runRound(0);
  }

  let bonusScale = 1, rounds = BONUS.ROUNDS;
  window.addEventListener("resize", () => { if (!$("#bonus").hidden) bonusScale = BONUS.fit($("#bArena")); });

  async function runRound(r) {
    const R = rounds[r], rnd = BONUS.rand(bonusSeed + r * 101);
    const rocks = BONUS.makeRocks(R.rocks, rnd, R.speed || 0, DB.now());
    bonus = { round: r, wave: -1, rocks, zone: null, startAt: 0, strikeAt: 0, lives: race.lives, key: "", bonusNo: race.leg, name: R.name, sub: R.sub };
    for (const id of activeIds().filter(id => players[id].bot)) bots[id] = { ...BONUS.spawn(rocks, Math.random), target: null };
    await DB.set(room("bonus"), bonus);
    await DB.update(room("state"), { phase: "bonus", round: r });
    $("#bRound").textContent = `Bonus ${race.leg} · ${R.name}`;
    $("#bSub").textContent = R.sub;
    setBanner(`${r ? R.name : `Bonus ${race.leg}: Missile Dodge`}<small>${esc(R.sub)}</small>`);
    sfx.reveal();
    bonusTimer(() => runWave(r, 0, null), 3500);
  }

  async function runWave(r, w, prevZone) {
    const R = rounds[r];
    const zone = BONUS.makeZone(R.zone, bonus.rocks, prevZone, Math.random);
    const zones = [zone];
    if (R.zones === 2) zones.push(BONUS.makeZone(R.zone, bonus.rocks, zone, Math.random));
    const startAt = DB.now();
    const caps = zones.length > 1 ? BONUS.capsFor(activeIds().length) : null;
    bonus = { ...bonus, wave: w, zone, zones, caps, occ: zones.map(() => 0), inside: null, startAt, strikeAt: startAt + R.warn,
      seed: Math.floor(Math.random() * 1e9), key: `${race.leg}-${r}-${w}`, lives: race.lives, hits: null };
    spots = {}; lastSpotsKey = "";
    await DB.set(room("bonus"), bonus);
    setBanner(zones.length > 1 ? `Two safe zones!<small>${caps[0] === caps[1] ? `${caps[0]} spots in each` : `${caps[0]} spots in one, ${caps[1]} in the other`}. Spread out so everyone fits!</small>` : "");
    if (zones.length > 1) bonusTimer(() => setBanner(""), 1600);
    // test players fly toward a zone (most of them make it)
    const aimed = zones.map(() => 0);
    for (const id of Object.keys(bots)) {
      if (out[id]) continue;
      const ok = Math.random() < .9;
      const room = zones.map((_, i) => (caps ? caps[i] : 99) - aimed[i]);
      const zi = room.indexOf(Math.max(...room)), q = zones[zi];
      aimed[zi]++;
      bots[id].target = ok
        ? { x: q.x + 20 + Math.random() * (q.w - 40), y: q.y + 20 + Math.random() * (q.h - 40) }
        : BONUS.spawn(bonus.rocks, Math.random);
      bots[id].delay = startAt + 300 + Math.random() * 1200;
    }
    bonusTimer(() => resolveWave(r, w), R.warn + 900);
  }

  async function resolveWave(r, w) {
    const R = rounds[r], z = bonus.zone;
    const reports = (await DB.get(room("safe/" + bonus.key))) || {};
    const hits = [];
    // Two zones: final positions decide who is in which zone; earliest arrivals get the spots.
    let spotted = null;
    if (bonus.zones.length > 1) {
      const finalPos = {};
      for (const id of activeIds())
        finalPos[id] = players[id].bot ? bots[id] : reports[id] ? { x: reports[id].x, y: reports[id].y } : podPos[id];
      spotted = assignSpots(finalPos, bonus.strikeAt);
    }
    for (const id of activeIds()) {
      let safe;
      if (spotted) safe = spotted[id] !== undefined;
      else if (players[id].bot) safe = BONUS.inZone(bots[id], z);
      else if (reports[id]) safe = !!reports[id].safe;
      else safe = BONUS.inZone(podPos[id], z);     // no report: use the last known position
      if (safe) { const s = scores[id] || (scores[id] = { score: 0, streak: 0 }); s.score += 100; }
      else { hits.push(id); out[id] = true; hitShow[id] = DB.now() + 1800; }
    }
    race.lives = Math.max(0, race.lives - hits.length);
    bonus = { ...bonus, hits, lives: race.lives };
    await DB.update(room(), { bonusOut: out, "race/lives": race.lives, "bonus/hits": hits, "bonus/lives": race.lives, "bonus/resolved": bonus.key, scores });

    if (hits.length) {
      sfx.alarm();
      const names = hits.slice(0, 4).map(id => esc(players[id]?.name || "")).join(", ") + (hits.length > 4 ? ` and ${hits.length - 4} more` : "");
      setBanner(`${hits.length} pod${hits.length > 1 ? "s" : ""} hit! −${hits.length} ${hits.length > 1 ? "lives" : "life"}<small>${names}</small>`, "bad");
    } else { sfx.win(); setBanner("Everyone made it!", "good"); }

    if (race.lives <= 0) return bonusTimer(() => endGame(true), 2600);
    if (!activeIds().length) return bonusTimer(() => finishBonus(), 2400);
    if (w + 1 < R.waves) bonusTimer(() => runWave(r, w + 1, z), 1900);
    else if (r + 1 < rounds.length) bonusTimer(() => runRound(r + 1), 2200);
    else bonusTimer(() => finishBonus(), 2200);
  }

  async function finishBonus() {
    const survivors = activeIds().length, total = Object.keys(players).length;
    race.escapes = (race.escapes || 0) + 1;
    const last = race.leg >= CHAPTERS.length;
    await DB.update(room(), { race, state: { phase: "bonusEnd", survivors }, scores });
    setBanner("");
    $("#bDoneTitle").textContent = survivors === total ? "Perfect dodging!" : "Bonus complete!";
    $("#bDoneText").innerHTML = `${survivors} of ${total} pods made it through all three rounds. The crew has ${race.lives} ${race.lives === 1 ? "life" : "lives"} left.<br>
      <span class="next-up">Next: ${esc(last ? "Fly home!" : CHAPTERS[race.leg].title)} <span id="bCount">10</span></span>`;
    $("#bContinue").textContent = last ? "Fly home now" : "Continue now";
    $("#bFinish").hidden = last;
    $("#bDone").hidden = false;
    let left = 10;
    const count = () => {
      left--;
      if ($("#bCount")) $("#bCount").textContent = left;
      if (left <= 0) continueStory(); else bonusTimer(count, 1000);
    };
    bonusTimer(count, 1000);
  }

  let continuing = false;
  async function continueStory() {
    if (continuing) return;
    continuing = true;
    clearTimers();
    out = {};
    await DB.update(room(), { bonusOut: null, pos: null, safe: null, bonus: null });
    if (race.leg >= CHAPTERS.length) {
      await playScene("home", ENDING);
      continuing = false;
      return endGame();
    }
    race = RACE.newLeg(race);
    for (const id in scores) scores[id].leg = 0;          // everyone needs 5 more
    await DB.update(room(), { race, scores });
    const ch = chapter();
    await playScene(ch.scene, ch.sceneText);
    continuing = false;
    startChase();
  }
  $("#bContinue").onclick = () => continueStory();
  $("#bFinish").onclick = () => { clearTimers(); endGame(); };

  // ─────────────── Cutscenes ───────────────
  function playScene(kind, [title, text]) {
    return new Promise(async resolve => {
      DB.update(room(), { state: { phase: "story", leg: race.leg, title, sub: text } });
      showScreen("story");
      const stage = $("#stage"), pod = $("#stPod"), robo = $("#stRobot"), smoke = $("#stSmoke"), flash = $("#stFlash");
      $("#stPlanet").className = "st-planet " + { crash: "p-crash", fuel: "p-moon", home: "p-home" }[kind];
      pod.innerHTML = podSVG();
      robo.innerHTML = robotSVG();
      $("#stCaption").hidden = true;
      smoke.style.opacity = 0;
      stage.getAnimations({ subtree: true }).forEach(a => a.cancel());
      const go = (el, frames, opts) => el.animate(frames, { fill: "forwards", ...opts });
      const at = (ms, fn) => setTimeout(fn, ms);
      const showCaption = () => { $("#stTitle").textContent = title; $("#stText").textContent = text; $("#stCaption").hidden = false; };
      let total;

      if (kind === "crash") {
        go(pod, [{ left: "-15%", top: "4%", transform: "rotate(115deg)" }, { left: "64%", top: "64%", transform: "rotate(150deg) scale(.85)" }],
          { duration: 3000, easing: "cubic-bezier(.45,0,.9,.6)" });
        go(robo, [{ left: "-30%", top: "-12%", transform: "rotate(25deg) scale(.7)" }, { left: "42%", top: "50%", transform: "rotate(30deg) scale(.55)" }],
          { duration: 3900, delay: 300, easing: "cubic-bezier(.45,0,.9,.6)" });
        at(3000, () => {
          sfx.alarm();
          go(flash, [{ opacity: 0 }, { opacity: .9 }, { opacity: 0 }], { duration: 700 });
          stage.animate([{ transform: "translate(0,0)" }, { transform: "translate(-14px,8px)" }, { transform: "translate(12px,-6px)" }, { transform: "translate(-6px,4px)" }, { transform: "translate(0,0)" }], { duration: 500 });
          smoke.style.left = "68%"; smoke.style.top = "68%"; smoke.style.opacity = 1;
        });
        at(3600, showCaption);
        total = 9000;
      } else if (kind === "fuel") {
        go(pod, [{ left: "-15%", top: "22%", transform: "rotate(90deg)" }, { left: "38%", top: "20%", transform: "rotate(90deg)", offset: .45 },
          { left: "58%", top: "57%", transform: "rotate(165deg) scale(.85)" }], { duration: 4600, easing: "ease-in-out" });
        const flame = pod.querySelector(".flame");
        at(1300, () => flame && flame.animate([{ opacity: 1 }, { opacity: .1 }, { opacity: 1 }, { opacity: 0 }], { duration: 900, fill: "forwards" }));
        go(robo, [{ left: "-35%", top: "6%", transform: "rotate(10deg) scale(.6)" }, { left: "38%", top: "52%", transform: "rotate(40deg) scale(.5)" }],
          { duration: 5600, delay: 500, easing: "ease-in-out" });
        at(4600, () => { sfx.tick(); smoke.style.left = "63%"; smoke.style.top = "62%"; smoke.style.opacity = .7; });
        at(5000, showCaption);
        total = 10000;
      } else {
        go(pod, [{ left: "8%", top: "70%", transform: "rotate(55deg) scale(1.1)" }, { left: "64%", top: "34%", transform: "rotate(65deg) scale(.22)" }],
          { duration: 4500, easing: "ease-in-out" });
        go(robo, [{ left: "34%", top: "26%", transform: "rotate(0deg) scale(.7)" }, { left: "-12%", top: "-18%", transform: "rotate(900deg) scale(.15)" }],
          { duration: 5200, easing: "ease-in" });
        at(4300, () => { showCaption(); sfx.win(); confetti(); });
        total = 8500;
      }
      at(total, resolve);
    });
  }

  function setBanner(html, kind = "") {
    const b = $("#bBanner");
    b.hidden = !html; b.innerHTML = html; b.className = "arena-banner " + kind;
  }

  // ── Limited zones: who got there first ──
  // spots[id] = { z: zone index, at: time they entered it }
  let spots = {}, lastSpotsKey = "", lastSpotsWrite = 0;
  function assignSpots(posById, now) {
    const zs = bonus.zones;
    for (const [id, p] of Object.entries(posById)) {
      const zi = p ? BONUS.zoneIndex(p, zs) : -1;
      if (zi < 0) delete spots[id];
      else if (!spots[id] || spots[id].z !== zi) spots[id] = { z: zi, at: now };
    }
    const inside = {};
    zs.forEach((_, zi) => {
      Object.keys(spots).filter(id => spots[id].z === zi && posById[id])
        .sort((a, b) => spots[a].at - spots[b].at)
        .slice(0, bonus.caps[zi])
        .forEach(id => inside[id] = zi);
    });
    return inside;
  }
  function trackSpots(now) {
    if (!bonus || !bonus.zones || bonus.zones.length < 2 || now < bonus.startAt || now >= bonus.strikeAt) return;
    const posById = {};
    for (const id of activeIds()) posById[id] = players[id].bot ? bots[id] : podPos[id];
    const inside = assignSpots(posById, now);
    const occ = bonus.zones.map((_, zi) => Object.values(inside).filter(v => v === zi).length);
    const key = JSON.stringify(inside);
    bonus.occ = occ;
    if (key !== lastSpotsKey && now - lastSpotsWrite > 250) {
      lastSpotsKey = key; lastSpotsWrite = now;
      DB.update(room("bonus"), { occ, inside });
    }
  }

  let lastFrame = 0;
  function drawBonus() {
    const now = DB.now(), dt = Math.min(.5, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (!bonus) return;
    trackSpots(now);
    const pods = [];
    for (const id of Object.keys(players)) {
      const hit = hitShow[id] && now < hitShow[id];
      if (out[id] && !hit) continue;
      let p;
      if (players[id].bot) {
        const b = bots[id]; if (!b) continue;
        if (!out[id] && bonus.zone && now > (b.delay || 0) && now < bonus.strikeAt) Object.assign(b, BONUS.moveFor(b, b.target, null, dt, BONUS.rocksAt(bonus.rocks, now)));
        p = b;
      } else {
        const t = podPos[id]; if (!t) continue;
        const s = podShow[id] || (podShow[id] = { x: t.x, y: t.y });
        s.x += (t.x - s.x) * .3; s.y += (t.y - s.y) * .3;     // smooth out network jumps
        p = s;
      }
      pods.push({ x: p.x, y: p.y, img: crewImage(players[id].color, players[id].gear), name: players[id].name, hit });
    }
    BONUS.draw($("#bArena").getContext("2d"), bonusScale, bonus, pods, now, { names: true });
    $("#bLives").textContent = race.lives;
    $("#bAlive").textContent = activeIds().length;
    const left = bonus.zone ? Math.ceil((bonus.strikeAt - now) / 1000) : 0;
    $("#bTimer").textContent = bonus.zone && left > 0 ? left : "";
    $("#bTimer").classList.toggle("hurry", left <= 2);
  }

  // ─────────────── End ───────────────
  async function endGame(outOfLives = false) {
    playing = false;
    clearTimers();
    const escapes = race.escapes || 0;
    const escaped = !outOfLives && escapes > 0;
    const keep = race.maxLives ? race.lives / race.maxLives : 1;
    const stars = escaped ? 1 + (keep >= .6 ? 1 : 0) + (keep >= .9 ? 1 : 0) : 0;
    const ranking = Object.keys(scores).filter(id => players[id]).sort((a, b) => scores[b].score - scores[a].score);
    await DB.update(room(), { state: { phase: "end", escaped, outOfLives, escapes, home: escapes >= CHAPTERS.length, stars, ranking: ranking.slice(0, 200) } });

    const home = escapes >= CHAPTERS.length;
    $("#endTitle").textContent = outOfLives ? "Out of lives!" : home ? ENDING[0] : escaped ? "We escaped!" : "So close!";
    $("#endTitle").className = outOfLives ? "lost" : "";
    $("#endSub").textContent = outOfLives
      ? "The missiles got the last of our lives. Play again for a cleaner escape!"
      : escaped
        ? `${home ? "All three chapters done!" : `The crew finished ${escapes} of ${CHAPTERS.length} chapters`} with ${race.lives} of ${race.maxLives} lives left.`
        : `The crew made it ${Math.floor(race.crew)}% of the way to the escape pods. Play again to escape!`;
    $("#endStars").innerHTML = escaped ? [0, 1, 2].map(k => `<span class="${k < stars ? "" : "off"}">★</span>`).join("") : "";
    const order = [1, 0, 2], heights = [200, 150, 110];
    $("#podium").innerHTML = order.filter(k => ranking[k]).map(k => {
      const id = ranking[k], p = players[id];
      return `<div class="step">${crewSVG(p.color, p.gear)}<div class="name">${esc(p.name)}</div><div class="pts">${scores[id].score} pts</div><div class="block" style="height:${heights[k]}px">${k + 1}</div></div>`;
    }).join("");
    showScreen("end");
    if (escaped) { sfx.win(); confetti(); } else sfx.alarm();
    continuing = false;
  }

  function confetti() {
    const box = document.createElement("div"); box.className = "confetti";
    const colors = ["#FFC93C", "#3DDBB0", "#4AA8FF", "#FF7AC6", "#A884FF"];
    for (let k = 0; k < 90; k++) {
      const i = document.createElement("i");
      i.style.left = Math.random() * 100 + "%";
      i.style.background = colors[k % colors.length];
      i.style.animationDuration = 2.5 + Math.random() * 2.5 + "s";
      i.style.animationDelay = Math.random() * 1.2 + "s";
      box.appendChild(i);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 7000);
  }

  $("#playAgain").onclick = async () => {
    race = RACE.start();
    scores = {}; processed = {};
    await DB.update(room(), { subs: null, results: null, scores: null, quiz: null, quizimg: null, race, bonus: null, bonusOut: null, pos: null, safe: null, state: { phase: "lobby" } });
    showScreen("lobby");
  };
  $("#newQuiz").onclick = async () => {
    clearTimers();
    unsubs.forEach(u => u()); unsubs = [];
    await DB.update(room(), { state: { phase: "closed" } });
    setTimeout(() => DB.remove(room()), 1500);
    code = null;
    showScreen("setup");
  };
})();
