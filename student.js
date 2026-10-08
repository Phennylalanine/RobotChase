/* Robo Chase — student screen */
(async function () {
  "use strict";

  $("#heroBot").innerHTML = robotSVG();
  $("#heroBot svg").classList.add("hero");
  $("#goneBot").innerHTML = robotSVG();
  $("#goneBot svg").classList.add("hero");

  let me, code = null, profile = null, state = null, unsubs = [];
  const room = p => `rooms/${code}${p ? "/" + p : ""}`;

  const saved = JSON.parse(localStorage.getItem("rc-profile") || "null") || { name: "", color: Math.floor(Math.random() * CREW_COUNT), gear: 0 };
  profile = { ...saved };

  try { me = await DB.start(); }
  catch (e) { showScreen("join"); showErr("#codeErr", "Can't connect right now. Check the internet and try again."); return; }
  showModeBanner();

  function showErr(sel, msg) { const el = $(sel); el.hidden = !msg; el.textContent = msg || ""; }

  // ─────────────── Code ───────────────
  const urlCode = new URLSearchParams(location.search).get("code");
  $("#codeIn").value = (urlCode || "").replace(/\D/g, "").slice(0, 6);
  $("#codeIn").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  $("#codeIn").addEventListener("keydown", e => { if (e.key === "Enter") $("#codeBtn").click(); });

  $("#codeBtn").onclick = async () => {
    const c = $("#codeIn").value.trim();
    if (c.length !== 6) return showErr("#codeErr", "The code has 6 numbers.");
    $("#codeBtn").disabled = true;
    try {
      const st = await DB.get(`rooms/${c}/state`);
      if (!st || st.phase === "closed") showErr("#codeErr", "No game with that code. Check the big screen.");
      else { code = c; showErr("#codeErr", ""); openProfile(); }
    } catch (e) { showErr("#codeErr", "Couldn't check the code: " + e.message); }
    $("#codeBtn").disabled = false;
  };

  // ─────────────── Name + avatar ───────────────
  const GEAR_LABELS = ["Antenna", "Plain", "Bow", "Horns"];
  function renderProfile() {
    $("#preview").innerHTML = crewSVG(profile.color, profile.gear, { run: false }) + `<div class="name">${esc(profile.name || "…")}</div>`;
    $("#colorPicker").innerHTML = Array.from({ length: CREW_COUNT }, (_, k) =>
      `<button data-color="${k}" aria-pressed="${k === profile.color}" aria-label="${CREW_NAMES[k]}">${crewSVG(k, profile.gear)}</button>`).join("");
    $("#gearPicker").innerHTML = GEAR_LABELS.map((g, k) => `<button data-gear="${k}" aria-pressed="${k === profile.gear}">${g}</button>`).join("");
  }
  function openProfile() {
    $("#nameIn").value = profile.name;
    renderProfile();
    showScreen("profile");
    setTimeout(() => $("#nameIn").focus(), 50);
  }
  $("#colorPicker").onclick = e => { const b = e.target.closest("[data-color]"); if (b) { profile.color = +b.dataset.color; renderProfile(); } };
  $("#gearPicker").onclick = e => { const b = e.target.closest("[data-gear]"); if (b) { profile.gear = +b.dataset.gear; renderProfile(); } };
  $("#nameIn").oninput = e => { profile.name = e.target.value; $("#preview .name").textContent = profile.name || "…"; };
  $("#nameIn").addEventListener("keydown", e => { if (e.key === "Enter") $("#joinBtn").click(); });

  $("#joinBtn").onclick = async () => {
    const name = profile.name.replace(/\s+/g, " ").trim().slice(0, 16);
    if (!name) return showErr("#joinErr", "Type a nickname first.");
    const others = (await DB.get(room("players"))) || {};
    if (Object.entries(others).some(([id, p]) => id !== me.uid && p.name.toLowerCase() === name.toLowerCase()))
      return showErr("#joinErr", "Someone already has that name. Try another.");
    profile.name = name;
    localStorage.setItem("rc-profile", JSON.stringify(profile));
    await DB.set(room("players/" + me.uid), { name, color: profile.color, gear: profile.gear, joinedAt: DB.TS });
    sessionStorage.setItem("rc-room", code);
    showErr("#joinErr", "");
    enterRoom();
  };

  // ─────────────── In the game ───────────────
  // Self-paced: this device shows question after question. Each answer goes to
  // the teacher's screen, which marks it and sends the result back.
  let qs = null, myScore = null, raceInfo = null, n = 0, awaiting = -1, playOn = false;
  let qTimer = null, fbTimer = null, waitTimer = null, curQ = -1, shownAt = 0;
  const imgCache = {};

  function enterRoom() {
    unsubs.forEach(u => u()); unsubs = [];
    const meArt = () => crewSVG(profile.color, profile.gear) + `<div class="name">${esc(profile.name)}</div>`;
    $("#waitMe").innerHTML = meArt();
    $("#endMe").innerHTML = meArt();
    let joined = false;
    unsubs.push(DB.on(room("players/" + me.uid), v => {
      if (v) { joined = true; return; }
      if (joined) leave("The teacher removed you from this game.");
    }));
    unsubs.push(DB.on(room("bonus"), v => { onBonus(v); }));
    unsubs.push(DB.on(room("bonusOut/" + me.uid), v => { amOut = !!v; render(); }));
    unsubs.push(DB.on(room("scores/" + me.uid), v => { myScore = v; updateGoal(); }));
    unsubs.push(DB.on(room("race"), v => { raceInfo = v; updateGoal(); }));
    unsubs.push(DB.on(room("results/" + me.uid), v => onResult(v)));
    unsubs.push(DB.on(room("state"), v => {
      if (!v || v.phase === "closed") return leave("This game has ended. Thanks for playing!");
      state = v; render();
    }));
    showScreen("wait");
  }

  function leave(msg) {
    unsubs.forEach(u => u()); unsubs = [];
    stopPlay(); stopBonusLoop();
    sessionStorage.removeItem("rc-room");
    $("#goneMsg").textContent = msg;
    showScreen("gone");
  }
  $("#goneBtn").onclick = () => { location.href = location.pathname; };

  async function rankText() {
    const all = (await DB.get(room("scores"))) || {};
    const ids = Object.keys(all).sort((a, b) => all[b].score - all[a].score);
    const k = ids.indexOf(me.uid);
    return k < 0 ? "–" : `${k + 1} of ${ids.length}`;
  }

  function render() {
    if (!state) return;
    const ph = state.phase;
    if (ph !== "play") stopPlay();
    if (ph !== "bonus") stopBonusLoop();

    if (ph === "lobby") {
      reported.clear(); qs = null; myScore = null;
      $("#waitMsg").textContent = "You're in!";
      $("#waitSub").textContent = "Watch the big screen.";
      return showScreen("wait");
    }
    if (ph === "play") return startPlay();
    if (ph === "pod" || ph === "story") {
      $("#waitMsg").textContent = state.title || "Everyone got 5!";
      $("#waitSub").textContent = (state.sub || "Get ready for the bonus round.") + " Look at the big screen!";
      return showScreen("wait");
    }
    if (ph === "bonus") {
      startBonusLoop();
      $(".stu-bonus").classList.toggle("out", amOut);
      return showScreen("bonusStu");
    }
    if (ph === "bonusEnd") {
      $("#waitMsg").textContent = amOut ? "Bonus over!" : "You dodged everything!";
      $("#waitSub").textContent = "Watch the big screen to see what's next.";
      return showScreen("wait");
    }
    if (ph === "end") {
      $("#endMsg").textContent = state.outOfLives ? "Out of lives! Next time we escape." : state.home ? "We made it home!" : state.escaped ? "We escaped the robot!" : "So close! Next time we escape.";
      $("#endScore").textContent = myScore ? myScore.score : 0;
      rankText().then(t => { $("#endRank").textContent = t; });
      return showScreen("end");
    }
  }

  // Each student gets their own shuffled order, reshuffled when the quiz runs out.
  function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function orderAt(k) {
    const N = qs.length, cyc = Math.floor(k / N);
    const perm = c => {
      const r = BONUS.rand(hashStr(me.uid) + c * 7919), a = [...Array(N).keys()];
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const p = perm(cyc);
    if (cyc > 0 && N > 1 && p[0] === perm(cyc - 1)[N - 1]) [p[0], p[1]] = [p[1], p[0]];   // no instant repeats
    return p[k % N];
  }

  function loadImg(i) {
    if (imgCache[i]) return Promise.resolve(imgCache[i]);
    return DB.get(room("quizimg/i" + i)).then(src => (imgCache[i] = src || null)).catch(() => null);
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

  async function startPlay() {
    if (playOn) return;
    playOn = true;
    $("#fb").hidden = true;
    $("#aText").textContent = "Get ready…";
    $("#aButtons").innerHTML = ""; $("#aImg").innerHTML = ""; $("#aTime").textContent = "";
    showScreen("answer");
    updateGoal();
    if (!qs) qs = await DB.get(room("quiz/q"));
    if (!qs || !qs.length) { playOn = false; return setTimeout(render, 1000); }
    const [last, sub] = await Promise.all([DB.get(room("results/" + me.uid)), DB.get(room("subs/" + me.uid))]);
    n = Math.max(last ? last.n : -1, sub ? sub.n : -1) + 1;
    if (playOn) nextQuestion();
  }

  function stopPlay() {
    playOn = false; awaiting = -1;
    clearInterval(qTimer); clearTimeout(fbTimer); clearTimeout(waitTimer);
    $("#fb").hidden = true;
  }

  async function nextQuestion() {
    if (!playOn) return;
    clearInterval(qTimer);
    const idx = orderAt(n), q = qs[idx], myN = n;
    curQ = idx; awaiting = -1;
    $("#aButtons").innerHTML = "";
    let src = null;
    if (q.img) {
      $("#aText").textContent = "…";
      src = await withTimeout(loadImg(idx), 4000);
      if (!playOn || myN !== n) return;
    }
    $("#fb").hidden = true;
    $("#aText").textContent = q.text;
    $("#aImg").innerHTML = src ? `<img class="qimg" src="${src}" alt="">` : "";
    $("#aButtons").innerHTML = q.answers.map((a, k) =>
      `<button class="ans" data-k="${k}" style="--c:${ANSWER_COLORS[k]}">${answerIcon(k)}<span>${esc(a)}</span></button>`).join("");
    shownAt = DB.now();
    const tickFn = () => {
      const left = Math.max(0, Math.ceil(q.time - (DB.now() - shownAt) / 1000));
      $("#aTime").textContent = left;
      updateGoal();
      if (left <= 0) submit(-1);
    };
    tickFn(); qTimer = setInterval(tickFn, 250);
    // fetch the next picture while this question is up
    const nq = qs[orderAt(n + 1)];
    if (nq && nq.img) loadImg(orderAt(n + 1));
  }

  function submit(choice) {
    if (!playOn || awaiting >= 0) return;
    clearInterval(qTimer);
    awaiting = n;
    $$("#aButtons .ans").forEach(x => { x.disabled = true; if (+x.dataset.k !== choice) x.classList.add("dim"); });
    if (navigator.vibrate) navigator.vibrate(30);
    DB.set(room("subs/" + me.uid), { n, q: curQ, choice, shownAt, at: DB.TS }).catch(() => {});
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => showFeedback("wait", "Checking…", "", ""), 600);
  }

  $("#aButtons").addEventListener("click", e => {
    const b = e.target.closest("[data-k]");
    if (b) submit(+b.dataset.k);
  });

  function showFeedback(kind, msg, gain, was, item) {
    const fb = $("#fb");
    fb.className = "feedback " + kind; fb.hidden = false;
    $("#fbMsg").textContent = msg; $("#fbGain").textContent = gain; $("#fbWas").textContent = was;
    $("#fbFound").innerHTML = item && FOUND[item] ? `${itemSVG(item)}<p lang="ja">${FOUND[item]}</p>` : "";
  }

  const FOUND = {
    gear: "ギアを みつけた！", wrench: "レンチを みつけた！", battery: "バッテリーを みつけた！",
    nut: "ナットを みつけた！", chip: "チップを みつけた！", fuel: "ねんりょうを ゲット！"
  };

  function onResult(v) {
    if (!v || !playOn || v.n !== awaiting) return;
    clearTimeout(waitTimer);
    const q = qs[curQ];
    const rightText = (v.right || []).map(k => q.answers[k]).join(" or ");
    if (v.correct) showFeedback("good", ["Correct!", "Great job!", "You got it!", "Boost!"][v.n % 4], `+${v.gained}`, "", v.item);
    else showFeedback("bad", awaiting >= 0 && $$("#aButtons .ans:not(.dim)").length === 0 ? "Time's up!" : "Not quite", "", `Answer: ${rightText}`);
    if (navigator.vibrate) navigator.vibrate(v.correct ? 40 : [80, 60, 80]);
    awaiting = -1;
    fbTimer = setTimeout(() => { n++; nextQuestion(); }, v.correct ? (v.item ? 1700 : 1200) : 2200);
  }

  function updateGoal() {
    $("#aRight").textContent = myScore?.leg || 0;
    $("#aPods").textContent = raceInfo && raceInfo.endsAt ? fmtTime((raceInfo.endsAt - DB.now()) / 1000) : "–";
    $("#aScore").textContent = myScore ? myScore.score : 0;
  }

  // ─────────────── Bonus: Missile Dodge ───────────────
  let bonus = null, amOut = false, pod = null, target = null, keys = {}, raf = 0, lastT = 0, lastSend = 0, sentPos = "", roundSeen = -1, reported = new Set(), scale = 1;
  const canvas = $("#sbArena");

  function onBonus(v) {
    bonus = v;
    if (!v) { roundSeen = -1; return; }
    if (v.round !== roundSeen) {            // new round: new asteroids, fresh start spot
      roundSeen = v.round;
      pod = BONUS.spawn(v.rocks || [], Math.random);
      target = null; sentPos = "";
    }
    if (v.hits && v.hits.includes(me.uid)) {
      setBanner("You got hit!<small>You're out until the next chase. Cheer on your crew!</small>", "bad");
    } else if (v.resolved === v.key && !amOut && (v.zones || []).length > 1) {
      setBanner("Safe! +100", "good");          // two zones: the teacher's screen decides
    }
  }

  function setBanner(html, kind = "") {
    const b = $("#sbBanner");
    b.hidden = !html; b.innerHTML = html; b.className = "arena-banner " + kind;
  }

  let rotate = false;
  function sizeArena() {
    rotate = window.innerHeight > window.innerWidth * 1.1;     // upright phone: turn the arena
    $("#sbWrap").classList.toggle("portrait", rotate);
    scale = BONUS.fit(canvas, rotate);
  }
  function startBonusLoop() {
    if (raf) return;
    requestAnimationFrame(sizeArena);
    lastT = DB.now();
    const loop = () => { frame(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }
  function stopBonusLoop() { cancelAnimationFrame(raf); raf = 0; keys = {}; }
  window.addEventListener("resize", () => { if (raf) sizeArena(); });

  function frame() {
    const now = DB.now(), prevT = lastT;
    lastT = now;
    let dt = Math.min(.5, (now - prevT) / 1000);
    // don't let a slow frame carry the pod past the moment of impact
    if (bonus && bonus.zone && now >= bonus.strikeAt && !reported.has(bonus.key)) dt = Math.max(0, Math.min(dt, (bonus.strikeAt - prevT) / 1000));
    if (!bonus || !pod) return;
    const R = { name: bonus.name || "Round", sub: bonus.sub || "" };
    const waveLive = bonus.zone && now >= bonus.startAt && now < bonus.strikeAt;

    // fly (allowed any time except after being hit)
    if (!amOut) {
      const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      const dir = rotate ? { x: sy, y: -sx } : { x: sx, y: sy };
      pod = BONUS.moveFor(pod, target, dir, dt, BONUS.rocksAt(bonus.rocks, now));
      if (target && Math.hypot(target.x - pod.x, target.y - pod.y) < 3) target = null;
      const key = Math.round(pod.x) + "," + Math.round(pod.y);
      if (now - lastSend > 160 && key !== sentPos) {
        lastSend = now; sentPos = key;
        DB.set(room("pos/" + me.uid), { x: Math.round(pod.x), y: Math.round(pod.y) });
      }
      // the moment the missiles land, report whether this pod was safe
      if (bonus.zone && now >= bonus.strikeAt && !reported.has(bonus.key)) {
        reported.add(bonus.key);
        const zs = BONUS.zonesOf(bonus), limited = zs.length > 1;
        const safe = BONUS.zoneIndex(pod, zs) >= 0;
        DB.set(room(`safe/${bonus.key}/${me.uid}`), { safe, x: Math.round(pod.x), y: Math.round(pod.y) }).catch(() => {});
        if (safe && !limited) setBanner("Safe! +100", "good");
        if (navigator.vibrate) navigator.vibrate(safe ? 40 : [80, 60, 80]);
      }
    }

    // words and timer
    const left = Math.ceil((bonus.strikeAt - now) / 1000);
    $("#sbRound").textContent = `Bonus ${bonus.bonusNo || 1} · ${R.name}`;
    $("#sbLives").textContent = bonus.lives ?? 0;
    $("#sbTime").textContent = waveLive && left > 0 ? left : "";
    if (amOut) $("#sbMsg").textContent = "You're sitting out until the next chase.";
    else if (waveLive) {
      const zs = BONUS.zonesOf(bonus), zi = BONUS.zoneIndex(pod, zs);
      if (zs.length > 1) {
        const mine = bonus.inside && bonus.inside[me.uid] !== undefined;
        $("#sbMsg").textContent = mine ? "You've got a spot! Stay there!"
          : zi >= 0 && (bonus.occ || [])[zi] >= (bonus.caps || [])[zi] ? "This zone is full! Fly to the other one!"
          : "Get to a green zone that still has space!";
      } else $("#sbMsg").textContent = zi >= 0 ? "You're in the safe zone. Stay there!" : "Get to the green zone!";
      if (!$("#sbBanner").classList.contains("bad")) setBanner("");
    } else if (!bonus.zone) {
      $("#sbMsg").textContent = "Tap where you want to fly, or use the arrow keys.";
      setBanner(`${R.name}<small>${esc(R.sub)}</small>`);
    }

    BONUS.draw(canvas.getContext("2d"), scale, bonus,
      [{ x: pod.x, y: pod.y, img: crewImage(profile.color, profile.gear), me: true, hit: amOut }],
      now, { target, rotate });
  }

  // tap / drag to steer
  const toArena = e => {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    return rotate ? { x: v * BONUS.W, y: BONUS.H - u * BONUS.H } : { x: u * BONUS.W, y: v * BONUS.H };
  };
  let dragging = false;
  canvas.addEventListener("pointerdown", e => { dragging = true; target = toArena(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener("pointermove", e => { if (dragging) target = toArena(e); });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointercancel", () => { dragging = false; });
  const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
  document.addEventListener("keydown", e => { const k = KEYMAP[e.key]; if (k && raf) { keys[k] = true; target = null; e.preventDefault(); } });
  document.addEventListener("keyup", e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });

  // ─────────────── Start ───────────────
  const back = sessionStorage.getItem("rc-room");
  if (back && (await DB.get(`rooms/${back}/players/${me.uid}`))) { code = back; enterRoom(); }
  else showScreen("join");
})();
