/* Robo Chase — Missile Dodge bonus game (shared by teacher and student screens)
   The arena is 1000 × 600 units on every screen; each screen scales it to fit. */
(function () {
  "use strict";

  const W = 1000, H = 600, POD_R = 18, SPEED = 360;

  // Three bonus games (one per chapter), each with three rounds of one strike each.
  // Raise "waves" to give a round more strikes.
  // speed > 0 means the asteroids drift and bounce around.
  const BONUSES = [
    [ // after chapter 1
      { name: "Round 1", sub: "Fly into the green zone before the missiles land!", warn: 5000, zone: [240, 180], rocks: 0, waves: 1 },
      { name: "Round 2", sub: "Asteroids ahead. Fly around them!", warn: 4600, zone: [210, 160], rocks: 5, waves: 1 },
      { name: "Round 3", sub: "Two safe zones with just enough spots for everyone, and the asteroids are moving. First come, first served!", warn: 5000, zone: [180, 140], rocks: 6, speed: 60, zones: 2, waves: 1 }
    ],
    [ // after chapter 2
      { name: "Round 1", sub: "Back in space, and it's rocky out here!", warn: 4800, zone: [220, 165], rocks: 4, waves: 1 },
      { name: "Round 2", sub: "More asteroids. Find a way through!", warn: 4400, zone: [195, 150], rocks: 7, waves: 1 },
      { name: "Round 3", sub: "Two zones, just enough spots, and a moving asteroid field. Grab a spot fast!", warn: 4800, zone: [170, 130], rocks: 7, speed: 75, zones: 2, waves: 1 }
    ],
    [ // after chapter 3: the asteroids move
      { name: "Round 1", sub: "The asteroids are moving! Don't get bumped out of the zone.", warn: 5000, zone: [230, 170], rocks: 4, speed: 55, waves: 1 },
      { name: "Round 2", sub: "Faster asteroids. Keep your eyes open!", warn: 4600, zone: [205, 155], rocks: 6, speed: 80, waves: 1 },
      { name: "Round 3", sub: "Final round! Two zones, just enough spots, fast asteroids!", warn: 4800, zone: [180, 140], rocks: 7, speed: 95, zones: 2, waves: 1 }
    ]
  ];
  const roundsFor = n => BONUSES[Math.max(0, Math.min(BONUSES.length - 1, n - 1))];
  const ROUNDS = BONUSES[0];

  function rand(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeRocks(n, rnd, speed = 0, t0 = 0) {
    const rocks = [];
    for (let tries = 0; rocks.length < n && tries < 600; tries++) {
      const r = 36 + rnd() * 30;
      const x = r + 70 + rnd() * (W - 2 * r - 140);
      const y = r + 50 + rnd() * (H - 2 * r - 100);
      // leave a gap wide enough for pods to squeeze through
      if (rocks.every(o => Math.hypot(o.x - x, o.y - y) >= o.r + r + 2 * POD_R + 24))
        rocks.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r), s: Math.floor(rnd() * 1e9) });
    }
    if (speed) rocks.forEach(o => {
      const a = rnd() * Math.PI * 2, v = speed * (.7 + rnd() * .6);
      o.vx = Math.round(Math.cos(a) * v); o.vy = Math.round(Math.sin(a) * v); o.t0 = t0;
    });
    return rocks;
  }

  // Where every asteroid is at time t (moving ones bounce off the walls).
  // Every screen computes this from the same start, so they all agree.
  function bounce(p0, v, dt, lo, hi) {
    const L = hi - lo;
    if (L <= 0 || !v) return p0;
    let m = ((p0 - lo) + v * dt) % (2 * L);
    if (m < 0) m += 2 * L;
    return lo + (m <= L ? m : 2 * L - m);
  }
  function rocksAt(rocks, t) {
    return (rocks || []).map(o => {
      if (!o.vx && !o.vy) return o;
      const dt = Math.max(0, (t - o.t0) / 1000);
      return { ...o, x: bounce(o.x, o.vx, dt, o.r, W - o.r), y: bounce(o.y, o.vy, dt, o.r, H - o.r) };
    });
  }
  const moving = rocks => (rocks || []).some(o => o.vx || o.vy);

  const rectRockGap = (z, o) => {
    const cx = Math.max(z.x, Math.min(o.x, z.x + z.w)), cy = Math.max(z.y, Math.min(o.y, z.y + z.h));
    return Math.hypot(o.x - cx, o.y - cy) - o.r;
  };

  function makeZone(size, rocks, prev, rnd) {
    const [w, h] = size;
    let best = null;
    for (let tries = 0; tries < 400; tries++) {
      const z = { x: Math.round(20 + rnd() * (W - w - 40)), y: Math.round(20 + rnd() * (H - h - 40)), w, h };
      if (!moving(rocks) && !rocks.every(o => rectRockGap(z, o) > 10)) continue;
      const far = !prev || Math.hypot((z.x + w / 2) - (prev.x + prev.w / 2), (z.y + h / 2) - (prev.y + prev.h / 2)) > 330;
      if (far) return z;
      best = best || z;
    }
    return best || { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function spawn(rocks, rnd) {
    for (let tries = 0; tries < 300; tries++) {
      const p = { x: POD_R + 30 + rnd() * (W - 2 * POD_R - 60), y: POD_R + 30 + rnd() * (H - 2 * POD_R - 60) };
      if (rocks.every(o => Math.hypot(o.x - p.x, o.y - p.y) > o.r + POD_R + 12)) return p;
    }
    return { x: W / 2, y: H - 40 };
  }

  // Spots in each of the two zones: the crew split exactly, so everyone fits
  // only if they spread out (15 pods → 7 and 8, 16 pods → 8 and 8).
  const capsFor = n => n <= 1 ? [1, 1] : [Math.floor(n / 2), Math.ceil(n / 2)];
  const zonesOf = st => st ? (st.zones || (st.zone ? [st.zone] : [])) : [];
  const zoneIndex = (p, zs) => zs.findIndex(z => inZone(p, z));
  const inZone = (p, z) => !!(p && z && p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h);

  // Move a pod toward a target point (or along a key direction), sliding around asteroids.
  function move(p, target, dir, dt, rocks) {
    let vx = 0, vy = 0, want = SPEED * dt;
    if (dir && (dir.x || dir.y)) {
      const m = Math.hypot(dir.x, dir.y); vx = dir.x / m; vy = dir.y / m;
    } else if (target && Math.hypot(target.x - p.x, target.y - p.y) >= 2) {
      const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
      vx = dx / d; vy = dy / d; want = Math.min(want, d);
    } else want = 0;      // standing still, but a moving asteroid can still shove us

    let nx = p.x + vx * want, ny = p.y + vy * want;
    for (let pass = 0; pass < 2; pass++) {
      for (const o of rocks || []) {
        const dx = nx - o.x, dy = ny - o.y, d = Math.hypot(dx, dy) || 0.001, min = o.r + POD_R;
        if (d < min) {
          const n = { x: dx / d, y: dy / d };
          nx = o.x + n.x * min; ny = o.y + n.y * min;
          // barely moved? slide sideways around the rock toward the goal
          if (pass === 0 && want > 0 && Math.hypot(nx - p.x, ny - p.y) < want * 0.4) {
            const side = Math.sign(n.x * vy - n.y * vx) || 1;
            nx += -n.y * side * want; ny += n.x * side * want;
          }
        }
      }
    }
    nx = Math.max(POD_R, Math.min(W - POD_R, nx));
    ny = Math.max(POD_R, Math.min(H - POD_R, ny));
    return { x: nx, y: ny };
  }

  // Same as move(), split into small steps so slow devices move just as far.
  function moveFor(p, target, dir, dt, rocks) {
    const n = Math.max(1, Math.ceil(dt / 0.02));
    for (let i = 0; i < n; i++) p = move(p, target, dir, dt / n, rocks);
    return p;
  }

  function impacts(zones, seed) {
    const rnd = rand(seed), pts = [];
    for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 4; gy++) {
      const x = (gx + .2 + rnd() * .6) * (W / 7), y = (gy + .2 + rnd() * .6) * (H / 4);
      if (zones.some(zone => x > zone.x - 40 && x < zone.x + zone.w + 40 && y > zone.y - 40 && y < zone.y + zone.h + 40)) continue;
      pts.push({ x, y, d: rnd() * 180 });
    }
    return pts;
  }

  // ───────── Drawing ─────────
  const starRnd = rand(7);
  const STARS = Array.from({ length: 90 }, () => ({ x: starRnd() * W, y: starRnd() * H, r: .6 + starRnd() * 1.6 }));

  function rockPath(ctx, o) {
    const rnd = rand(o.s), n = 11;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, rr = o.r * (.84 + rnd() * .2);
      const x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  function draw(ctx, scale, st, pods, now, opts = {}) {
    ctx.save();
    // opts.rotate turns the arena a quarter turn to fill an upright phone
    if (opts.rotate) ctx.setTransform(0, scale, -scale, 0, H * scale, 0);
    else ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const upright = (x, y, fn) => { ctx.save(); ctx.translate(x, y); if (opts.rotate) ctx.rotate(-Math.PI / 2); fn(); ctx.restore(); };
    ctx.fillStyle = "#0E1238"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.7)";
    for (const s of STARS) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
    ctx.strokeStyle = "rgba(169,177,222,.08)"; ctx.lineWidth = 2;
    for (let x = 100; x < W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 100; y < H; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const z = st && st.zone, zs = zonesOf(st), live = z && now >= st.startAt && now < st.strikeAt + 1600;

    // danger: everything outside the zone flashes red as the strike nears
    if (live && now < st.strikeAt + 900) {
      const left = st.strikeAt - now, warn = st.strikeAt - st.startAt;
      const a = now < st.strikeAt ? (.06 + .24 * (1 - left / warn)) * (.65 + .35 * Math.sin(now / 80)) : .38;
      ctx.fillStyle = `rgba(255,90,95,${a})`;
      ctx.beginPath(); ctx.rect(0, 0, W, H); zs.forEach(q => ctx.rect(q.x, q.y, q.w, q.h)); ctx.fill("evenodd");
    }

    // asteroids
    for (const o of rocksAt(st && st.rocks, now)) {
      rockPath(ctx, o);
      ctx.fillStyle = "#7B6C8F"; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = "#4A3E5E"; ctx.stroke();
      const cr = rand(o.s + 1);
      ctx.fillStyle = "#5E5172";
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(o.x + (cr() - .5) * o.r, o.y + (cr() - .5) * o.r, o.r * (.12 + cr() * .12), 0, 7); ctx.fill(); }
    }

    // safe zone(s)
    if (live) {
      const pulse = .5 + .5 * Math.sin(now / 160), limited = zs.length > 1;
      zs.forEach((q, i) => {
        const cap = (st.caps || [])[i] || 0, n = (st.occ && st.occ[i]) || 0, full = limited && n >= cap;
        ctx.fillStyle = full ? `rgba(255,201,60,${.2 + .1 * pulse})` : `rgba(61,219,176,${.22 + .1 * pulse})`;
        ctx.fillRect(q.x, q.y, q.w, q.h);
        ctx.setLineDash([18, 12]); ctx.lineDashOffset = -now / 30;
        ctx.lineWidth = 6; ctx.strokeStyle = full ? "#FFC93C" : "#3DDBB0"; ctx.strokeRect(q.x, q.y, q.w, q.h);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(244,246,255,.9)"; ctx.font = "600 30px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const label = limited ? (full ? "FULL" : `${n} / ${cap}`) : "SAFE";
        upright(q.x + q.w / 2, q.y + q.h / 2, () => ctx.fillText(label, 0, 0));
      });
    }

    // missiles fall during the last 0.8 s, then explode
    if (live) {
      const pts = impacts(zs, st.seed || 1);
      for (const p of pts) {
        const t0 = st.strikeAt - 800 + p.d * 0.4;
        if (now >= t0 && now < st.strikeAt) {
          const k = (now - t0) / (st.strikeAt - t0), y = -40 + (p.y + 40) * k, x = p.x - 60 * (1 - k);
          ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(p.y + 40, 60) - Math.PI / 2);
          ctx.fillStyle = "#FFC93C"; ctx.beginPath(); ctx.moveTo(-5, -26); ctx.lineTo(0, -40); ctx.lineTo(5, -26); ctx.fill();
          ctx.fillStyle = "#E9EDFF"; ctx.fillRect(-6, -26, 12, 30);
          ctx.fillStyle = "#FF5A5F"; ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(0, 16); ctx.lineTo(6, 4); ctx.fill();
          ctx.restore();
        }
        const e = (now - st.strikeAt) / 800;
        if (e >= 0 && e < 1) {
          ctx.fillStyle = `rgba(255,201,60,${1 - e})`; ctx.beginPath(); ctx.arc(p.x, p.y, 18 + 60 * e, 0, 7); ctx.fill();
          ctx.fillStyle = `rgba(255,90,95,${(1 - e) * .8})`; ctx.beginPath(); ctx.arc(p.x, p.y, 10 + 34 * e, 0, 7); ctx.fill();
        }
      }
    }

    // pods
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (const p of pods) {
      ctx.globalAlpha = p.hit ? .45 : 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, POD_R + 6, 0, 7);
      ctx.fillStyle = "rgba(233,237,255,.18)"; ctx.fill();
      ctx.lineWidth = p.me ? 5 : 3; ctx.strokeStyle = p.me ? "#FFC93C" : "rgba(233,237,255,.7)"; ctx.stroke();
      if (p.img && p.img.complete) upright(p.x, p.y, () => ctx.drawImage(p.img, -19, -23, 38, 42));
      if (p.hit) {
        ctx.strokeStyle = "#FF5A5F"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(p.x - 16, p.y - 16); ctx.lineTo(p.x + 16, p.y + 16); ctx.moveTo(p.x + 16, p.y - 16); ctx.lineTo(p.x - 16, p.y + 16); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (p.name && opts.names) {
        ctx.font = "600 16px Fredoka, sans-serif";
        const w = ctx.measureText(p.name).width + 12;
        ctx.fillStyle = "rgba(20,26,69,.8)"; ctx.fillRect(p.x - w / 2, p.y + POD_R + 8, w, 20);
        ctx.fillStyle = "#F4F6FF"; ctx.fillText(p.name, p.x, p.y + POD_R + 10);
      }
    }
    if (opts.target) {
      ctx.strokeStyle = "rgba(255,201,60,.8)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(opts.target.x, opts.target.y, 12, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  // Size a canvas to its box at the screen's pixel density; returns the arena scale.
  function fit(canvas, rotate) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * (rotate ? W / H : H / W) * dpr);
    return canvas.width / (rotate ? H : W);
  }

  window.BONUS = { W, H, POD_R, SPEED, ROUNDS, BONUSES, roundsFor, rand, makeRocks, rocksAt, makeZone, spawn, inZone, zonesOf, zoneIndex, capsFor, move, moveFor, draw, fit };
})();
