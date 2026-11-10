/* Robot Mission Demo - throwaway prototype. FAKE data only.
 *
 * Nothing here talks to a network: no fetch, no sockets, no fonts, no
 * analytics. The camera page builds its JPEG frames in the page itself.
 *
 * URL parameters:
 *   debug=0   hide the diagnostics strip (on by default for now)
 *   fps=N     camera target rate at start (default 10; the page has 10/20/30)
 *   t=N       start the fake timeline N seconds in (it loops every 120 s)
 *   arrows=1  desktop aid only: the page moves focus on arrow keys, for
 *             browsers without spatial navigation. Leave it off on the
 *             glasses, where the browser itself moves focus.
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') !== '0';
  const PAGE_ARROWS = params.get('arrows') === '1';
  const T_OFFSET = Number(params.get('t')) || 0;

  const $ = (id) => document.getElementById(id);
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

  // ------------------------------------------------------------------
  // Fake mission: a scripted timeline that loops. Everything shown is a
  // pure function of the timeline second, so updates never rebuild the page.
  // ------------------------------------------------------------------

  const ROBOT = 'Robot 1';
  const MISSION = 'Warehouse check';
  const LOOP_S = 120;
  const REASON_EVERY_S = 6;
  const NEW_FOR_S = 5; // how long a new finding stays highlighted

  const ACTIVITIES = [
    [0, 'Walking to the loading dock'],
    [18, 'Checking dock door 2'],
    [42, 'Walking along shelf row B'],
    [64, 'Checking the cold room door'],
    [84, 'Trying the side entrance'],
    [102, 'Returning to the start point'],
  ];

  const REASONING = [
    'New mission. Planning a route to the loading dock.',
    'Main aisle is clear; taking the direct route.',
    'Something is on the floor ahead. Slowing down.',
    'It is a pallet in front of dock door 2. Logging it.',
    'Going around the pallet on the left side.',
    'Door 2 is closed; looking at the seal.',
    'Seal may be torn at the bottom. Not sure from here.',
    'Logged as uncertain. Moving on to shelf row B.',
    'Reading the shelf labels as I pass.',
    'No label on shelf B4. Checking the other side.',
    'Still no label. Logging it.',
    'Heading to the cold room door.',
    'Cold room door looks slightly open. Light is poor.',
    'Cannot confirm from this angle. Logging as uncertain.',
    'Front door is closed; trying the side entrance.',
    'Side entrance handle moves freely.',
    'Door opens without a badge. Logging it.',
    'All areas covered. Returning to the start point.',
    'Battery is fine for the way back.',
    'Almost at the start point. Preparing the summary.',
  ];

  // Route keyframes: [second, x, y] on a 100 x 100 site, y pointing down.
  const ROUTE = [
    [0, 14, 84], [14, 14, 16], [20, 40, 16], [28, 46, 16], [40, 46, 22],
    [48, 46, 50], [60, 70, 50], [66, 84, 50], [80, 84, 80], [84, 84, 84],
    [100, 48, 84], [120, 14, 84],
  ];

  const BLOCKS = [ // x, y, w, h
    [22, 24, 16, 52],
    [54, 26, 38, 16],
    [54, 58, 22, 18],
  ];

  const MAP_LABELS = [ // x, y, text (large map only)
    [44, 11, 'Dock'],
    [73, 34, 'Row B'],
    [14, 91, 'Start'],
    [48, 91, 'Side entrance'],
    [84, 91, 'Cold room'],
  ];

  // at: timeline second at which the finding appears (-1: already known).
  const FINDINGS = [
    { n: 1, at: -1, x: 14, y: 62, subject: 'Fire door propped open', status: 'observed' },
    { n: 2, at: -1, x: 30, y: 84, subject: 'Spill near charging bay', status: 'uncertain' },
    { n: 3, at: -1, x: 66, y: 84, subject: 'Exit sign not lit', status: 'observed' },
    { n: 4, at: 20, subject: 'Pallet blocks dock door 2', status: 'observed' },
    { n: 5, at: 40, subject: 'Door seal may be torn', status: 'uncertain' },
    { n: 6, at: 60, subject: 'Shelf B4 has no label', status: 'observed' },
    { n: 7, at: 80, subject: 'Cold room door may be open', status: 'uncertain' },
    { n: 8, at: 100, subject: 'Side entrance not locked', status: 'observed' },
  ];

  function posAt(t) {
    let i = 0;
    while (i < ROUTE.length - 2 && ROUTE[i + 1][0] <= t) i++;
    const a = ROUTE[i];
    const b = ROUTE[i + 1];
    const k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    return {
      x: a[1] + (b[1] - a[1]) * k,
      y: a[2] + (b[2] - a[2]) * k,
      heading: Math.atan2(b[2] - a[2], b[1] - a[1]),
    };
  }

  for (const f of FINDINGS) {
    if (f.at >= 0) {
      const p = posAt(f.at);
      f.x = p.x;
      f.y = p.y;
    }
  }

  const T0 = performance.now();
  function clock() {
    const t = ((performance.now() - T0) / 1000 + T_OFFSET) % LOOP_S;
    return t < 0 ? t + LOOP_S : t;
  }

  function stateAt(t) {
    let activity = ACTIVITIES[0][1];
    for (const [at, text] of ACTIVITIES) if (at <= t) activity = text;
    const ri = Math.floor(t / REASON_EVERY_S) % REASONING.length;
    const rn = REASONING.length;
    return {
      t,
      battery: 78 - Math.floor(t / 40),
      elapsedMin: 12 + Math.floor(t / 60),
      activity,
      reasoning: [REASONING[ri], REASONING[(ri + rn - 1) % rn], REASONING[(ri + rn - 2) % rn]],
      findings: FINDINGS.filter((f) => f.at <= t),
      pos: posAt(t),
    };
  }

  const statusText = (f) => (f.status === 'observed' ? '● observed' : '○ uncertain');

  // ------------------------------------------------------------------
  // Diagnostics strip: what this browser actually delivers.
  // ------------------------------------------------------------------

  const diagEl = $('diag');
  const dg = {
    keys: [], keyN: 0,
    actId: '-', actN: 0,
    popN: 0, popInfo: '-',
    push: '-',
    lost: 0, refocus: 0, backFallback: 0,
    arrowMoved: 0, arrowStuck: 0,
    txtInput: 0, txtChange: 0, txtLen: 0,
    errN: 0, err: '',
  };
  // The user agent without its two boilerplate parts (the first token and
  // the engine block after the platform), so the telling parts fit one line.
  const UA_SHORT = navigator.userAgent
    .replace(/^\S+ /, '')
    .replace(/\) \S+ \([^)]*\) /, ') ');
  const DIAG_COLS = 80;

  function focusName() {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return 'none';
    return a.id || a.tagName.toLowerCase();
  }

  function paintDiag() {
    if (!DEBUG) return;
    const keys = dg.keys.slice();
    let l1 = 'keys(' + dg.keyN + '): ' + keys.join(' ');
    while (l1.length > DIAG_COLS && keys.length > 1) {
      keys.shift();
      l1 = 'keys(' + dg.keyN + '): ' + keys.join(' ');
    }
    const l2 = 'focus:' + focusName() + ' act:' + dg.actId + '#' + dg.actN +
      ' pop#' + dg.popN + ':' + dg.popInfo + ' hist:' + history.length + ' push1:' + dg.push;
    let l3 = innerWidth + 'x' + innerHeight + '@' + (Math.round((devicePixelRatio || 1) * 100) / 100) +
      ' ' + (navigator.onLine ? 'online' : 'OFFLINE') +
      ' lost:' + dg.lost + ' refocus:' + dg.refocus +
      ' arrows:' + (PAGE_ARROWS ? 'page' : 'browser') + ' ' + dg.arrowMoved + '/' + dg.arrowStuck;
    if (dg.backFallback) l3 += ' backfb:' + dg.backFallback;
    if (dg.txtInput || dg.txtChange) l3 += ' txt:in' + dg.txtInput + '/ch' + dg.txtChange + '/len' + dg.txtLen;
    let l4;
    if (dg.errN) l4 = 'ERR(' + dg.errN + '): ' + dg.err;
    else if (!PAGE_ARROWS && dg.arrowMoved === 0 && dg.arrowStuck >= 3) l4 = 'arrows moved no focus here. Desktop: use Tab, or add ?arrows=1';
    else l4 = 'ua:' + (UA_SHORT.length > DIAG_COLS - 3 ? '…' + UA_SHORT.slice(-(DIAG_COLS - 4)) : UA_SHORT);
    const clip = (s) => (s.length > DIAG_COLS ? s.slice(0, DIAG_COLS - 1) + '…' : s);
    setText(diagEl, [l1, l2, l3, l4].map(clip).join('\n'));
  }

  function noteError(msg) {
    dg.errN++;
    dg.err = String(msg);
    paintDiag();
  }
  window.addEventListener('error', (e) => noteError(e.message || 'error'));
  window.addEventListener('unhandledrejection', (e) => noteError((e.reason && e.reason.message) || e.reason || 'rejection'));

  // ------------------------------------------------------------------
  // Pages and history. Mission is the root entry; every other page is ONE
  // pushState entry on top of it, so the stack never holds more than two
  // entries (the host allows five). Back - the glasses' gesture or the
  // browser button - arrives as popstate and the state is restored there.
  // ------------------------------------------------------------------

  const PAGES = {
    mission: $('page-mission'),
    map: $('page-map'),
    camera: $('page-camera'),
    finding: $('page-finding'),
    new: $('page-new'),
  };
  const HOME = { screen: 'mission' };
  let cur = { screen: '' };
  let pendingToast = '';

  // Navigation is the one place where the page directs focus (standard
  // focus()), because the control that had focus is gone. Some hosts move
  // focus again while they apply the history entry; one late check puts it
  // back and counts that in the diagnostics ("refocus").
  const nav = { busy: false, seq: 0 };

  function directFocus(el) {
    if (!el) return;
    const seq = ++nav.seq;
    const keysThen = dg.keyN;
    nav.busy = true;
    el.focus({ preventScroll: true });
    setTimeout(() => {
      if (seq !== nav.seq) return;
      nav.busy = false;
      if (dg.keyN === keysThen && document.activeElement !== el && el.getClientRects().length) {
        el.focus({ preventScroll: true });
        dg.refocus++;
      }
      paintDiag();
    }, 200);
  }

  function render(state) {
    const screen = state && PAGES[state.screen] ? state.screen : 'mission';
    const prev = cur.screen;
    cur = Object.assign({}, state, { screen });
    nav.busy = true;
    if (prev === 'camera' && screen !== 'camera') cameraStop();

    PAGES[screen].hidden = false;
    let target;
    if (screen === 'mission') {
      target = $(cur.focus || '') || $('f0');
      if (pendingToast) {
        showToast(pendingToast);
        pendingToast = '';
      }
    } else if (screen === 'map') {
      target = $('map-back');
    } else if (screen === 'camera') {
      target = $('cam-back');
      cameraStart();
    } else if (screen === 'finding') {
      target = $('fd-back');
      paintFinding(cur.n);
    } else {
      const step = cur.step === 2 ? 2 : 1;
      newMissionShow(step, cur.text || '');
      target = step === 2 ? $('nm-start') : $('nm-input');
    }
    tick();
    directFocus(target);
    for (const name in PAGES) if (name !== screen) PAGES[name].hidden = true;
    paintDiag();
  }

  function openPage(state, openerId) {
    if (cur.screen !== 'mission') return; // sub-pages never stack on each other
    // Remember on the root entry which control opened the page, so Back can
    // put focus where it was.
    history.replaceState({ screen: 'mission', focus: openerId }, '');
    const before = history.length;
    history.pushState(state, '');
    // history.length before and after the first push of this page load. (Only
    // the first: after a Back, a push replaces the forward entry and the
    // length stays the same, which would look like a push that did nothing.)
    if (dg.push === '-') dg.push = before + '>' + history.length;
    render(state);
  }

  function goBack() {
    if (cur.screen === 'mission') return;
    const popsThen = dg.popN;
    history.back();
    // If the host delivers no popstate, do not leave the tester stranded:
    // show Mission anyway and say so in the diagnostics ("backfb").
    setTimeout(() => {
      if (dg.popN === popsThen && cur.screen !== 'mission') {
        dg.backFallback++;
        history.replaceState(HOME, '');
        render(HOME);
      }
    }, 800);
  }

  window.addEventListener('popstate', (e) => {
    const state = e.state || HOME;
    dg.popN++;
    dg.popInfo = (PAGES[state.screen] ? state.screen : 'mission') + '@' + new Date().toTimeString().slice(0, 8);
    render(state);
  });

  // ------------------------------------------------------------------
  // 1. Mission: text, findings and the small map update in place. The
  // three finding rows are fixed buttons whose text changes; nothing is
  // added, removed or re-created, so the browser's focus is never touched.
  // ------------------------------------------------------------------

  const mTop = $('m-top');
  const mNow = $('m-now');
  const mReason = [$('m-r0'), $('m-r1'), $('m-r2')];
  const mCount = $('m-fcount');
  const rows = ['f0', 'f1', 'f2'].map((id) => {
    const el = $(id);
    return {
      el,
      num: el.querySelector('.fnum'),
      sub: el.querySelector('.fsub'),
      stat: el.querySelector('.fstat'),
      n: 0,
    };
  });
  const miniMap = $('mini-map');
  const bigMap = $('big-map');
  const toastEl = $('toast');
  let toastTimer = 0;

  function paintMission(st) {
    setText(mTop, ROBOT + ' · Battery ' + st.battery + '% · ' + MISSION + ' · ' + st.elapsedMin + ' min');
    setText(mNow, st.activity);
    for (let i = 0; i < 3; i++) setText(mReason[i], st.reasoning[i]);
    setText(mCount, 'Findings · ' + st.findings.length);
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k];
      const f = st.findings[st.findings.length - 1 - k]; // newest first
      const isNew = f.at >= 0 && st.t - f.at < NEW_FOR_S;
      row.n = f.n;
      setText(row.num, '#' + f.n);
      setText(row.sub, f.subject);
      setText(row.stat, statusText(f) + (isNew ? ' · new' : ''));
      row.el.classList.toggle('uncertain', f.status !== 'observed');
      row.el.classList.toggle('is-new', isNew);
    }
    drawMap(miniMap, st, false);
  }

  function showToast(text) {
    setText(toastEl, text);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5000);
  }

  // ------------------------------------------------------------------
  // Map drawing (small on Mission, large on the Map page).
  // ------------------------------------------------------------------

  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr);
    const h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return null;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return { ctx: cv.getContext('2d'), w, h, dpr };
  }

  function drawMap(cv, st, big) {
    const fit = fitCanvas(cv);
    if (!fit) return;
    const { ctx, w, h, dpr } = fit;
    const s = Math.min(w, h) / 100;
    const ox = (w - 100 * s) / 2;
    const oy = (h - 100 * s) / 2;
    const X = (x) => ox + x * s;
    const Y = (y) => oy + y * s;
    const px = dpr; // one CSS pixel

    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Site outline, the dock door on the top wall, and the blocks.
    ctx.strokeStyle = '#70808b';
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(X(6), Y(6), 88 * s, 88 * s);
    ctx.strokeStyle = '#e8eef2';
    ctx.lineWidth = 3.5 * px;
    ctx.beginPath();
    ctx.moveTo(X(37), Y(6));
    ctx.lineTo(X(52), Y(6));
    ctx.stroke();
    ctx.fillStyle = '#26323a';
    ctx.strokeStyle = '#5d6b75';
    ctx.lineWidth = px;
    for (const [bx, by, bw, bh] of BLOCKS) {
      ctx.fillRect(X(bx), Y(by), bw * s, bh * s);
      ctx.strokeRect(X(bx), Y(by), bw * s, bh * s);
    }

    if (big) {
      ctx.fillStyle = '#9fb0ba';
      ctx.font = Math.round(13 * px) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [lx, ly, text] of MAP_LABELS) ctx.fillText(text, X(lx), Y(ly));
    }

    // Walked path so far in this loop.
    ctx.strokeStyle = '#4fd8ff';
    ctx.lineWidth = (big ? 3.5 : 2.5) * px;
    ctx.beginPath();
    ctx.moveTo(X(ROUTE[0][1]), Y(ROUTE[0][2]));
    for (const [at, x, y] of ROUTE) if (at <= st.t) ctx.lineTo(X(x), Y(y));
    ctx.lineTo(X(st.pos.x), Y(st.pos.y));
    ctx.stroke();

    // Finding pins: filled = observed, hollow = uncertain.
    const r = (big ? 9 : 4.5) * px;
    for (const f of st.findings) {
      const cx = X(f.x);
      const cy = Y(f.y);
      const observed = f.status === 'observed';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = observed ? '#6dffa8' : '#000';
      ctx.fill();
      ctx.strokeStyle = observed ? '#000' : '#ffc857';
      ctx.lineWidth = (observed ? 1 : 2) * px;
      ctx.stroke();
      if (f.at >= 0 && st.t - f.at < NEW_FOR_S) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4 * px, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
      }
      if (big) {
        ctx.fillStyle = observed ? '#000' : '#ffc857';
        ctx.font = 'bold ' + Math.round(12 * px) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(f.n), cx, cy + px);
      }
    }

    // Robot: an arrow pointing where it walks.
    const a = (big ? 14 : 9) * px;
    ctx.save();
    ctx.translate(X(st.pos.x), Y(st.pos.y));
    ctx.rotate(st.pos.heading);
    ctx.beginPath();
    ctx.moveTo(a, 0);
    ctx.lineTo(-0.75 * a, 0.65 * a);
    ctx.lineTo(-0.35 * a, 0);
    ctx.lineTo(-0.75 * a, -0.65 * a);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // 4. Finding: static text plus a generated placeholder picture.
  // ------------------------------------------------------------------

  function seeded(seed) { // small deterministic generator
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function paintFinding(n) {
    const f = FINDINGS.find((x) => x.n === n) || FINDINGS[0];
    setText($('fd-title'), 'Finding #' + f.n);
    setText($('fd-subject'), f.subject);
    const st = $('fd-status');
    setText(st, statusText(f));
    st.classList.toggle('uncertain', f.status !== 'observed');

    const fit = fitCanvas($('fd-pic'));
    if (!fit) return;
    const { ctx, w, h, dpr } = fit;
    const rnd = seeded(f.n * 7919);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16222a');
    g.addColorStop(0.55, '#2c3c46');
    g.addColorStop(0.56, '#1d2a31');
    g.addColorStop(1, '#0e161b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { // some boxes standing on the "floor"
      const bw = (0.08 + rnd() * 0.16) * w;
      const bh = (0.12 + rnd() * 0.3) * h;
      const bx = rnd() * (w - bw);
      const by = 0.56 * h - bh * (0.4 + rnd() * 0.6) + rnd() * 0.25 * h;
      const shade = 60 + Math.floor(rnd() * 90);
      ctx.fillStyle = 'rgb(' + shade + ',' + (shade + 14) + ',' + (shade + 24) + ')';
      ctx.fillRect(bx, by, bw, bh);
    }
    // The region the claim is about.
    const rx = (0.2 + rnd() * 0.3) * w;
    const ry = (0.2 + rnd() * 0.25) * h;
    const rw = 0.3 * w;
    const rh = 0.38 * h;
    ctx.setLineDash([8 * dpr, 6 * dpr]);
    ctx.strokeStyle = f.status === 'observed' ? '#6dffa8' : '#ffc857';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    const label = 'Placeholder picture · #' + f.n;
    ctx.font = Math.round(14 * dpr) + 'px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(8 * dpr, h - 32 * dpr, tw + 16 * dpr, 24 * dpr);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, 16 * dpr, h - 20 * dpr);
  }

  // ------------------------------------------------------------------
  // 5. New mission: a plain text field (the glasses open their own
  // composer for it), then a confirm step. Nothing is sent anywhere.
  // ------------------------------------------------------------------

  const nmInput = $('nm-input');
  const nmHint = $('nm-hint');

  function newMissionShow(step, text) {
    $('nm-step1').hidden = step !== 1;
    $('nm-step2').hidden = step !== 2;
    if (step === 1) {
      nmInput.value = text;
      setText(nmHint, ' ');
    } else {
      setText($('nm-text'), text);
    }
  }

  function newMissionNext() {
    const text = nmInput.value.trim();
    if (!text) {
      setText(nmHint, 'Enter a mission first.');
      return;
    }
    cur = { screen: 'new', step: 2, text };
    history.replaceState(cur, ''); // same entry; Back still returns to Mission
    newMissionShow(2, text);
    directFocus($('nm-start'));
  }

  function noteText(kind) {
    if (kind === 'input') dg.txtInput++;
    else dg.txtChange++;
    dg.txtLen = nmInput.value.length;
    paintDiag();
  }
  nmInput.addEventListener('input', () => noteText('input'));
  nmInput.addEventListener('change', () => noteText('change'));

  // ------------------------------------------------------------------
  // 3. Camera: a fake moving picture through the real display path.
  // Each frame is drawn on a 240 x 240 canvas, encoded to JPEG (quality
  // 0.4) and shown by swapping the <img> source to a fresh object URL.
  // "fps" counts frames that were decoded and reached an animation frame.
  // "Source: replay" encodes 40 frames once and then only swaps them, so
  // the measured rate no longer includes the cost of making the frames.
  // ------------------------------------------------------------------

  const CAM_SIZE = 240;
  const CAM_QUALITY = 0.4;
  const REPLAY_FRAMES = 40;
  const camImg = $('cam-img');
  const camHud = $('cam-hud');
  const cam = {
    token: 0, target: 10, replay: false,
    frames: [], url: '', frameNo: 0,
    stamps: [], kb: 0, makeMs: 0, showMs: 0, failed: 0, note: '',
    scene: null, noise: null,
  };
  {
    const wanted = Math.round(Number(params.get('fps')));
    if (wanted >= 1 && wanted <= 60) cam.target = wanted;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  const smooth = (old, v) => (old ? old * 0.8 + v * 0.2 : v);

  function camSetup() {
    if (cam.scene) return;
    cam.scene = document.createElement('canvas');
    cam.scene.width = cam.scene.height = CAM_SIZE;
    // Fixed grain, shifted every frame, so the JPEG has real texture to carry.
    cam.noise = document.createElement('canvas');
    cam.noise.width = cam.noise.height = CAM_SIZE;
    const nctx = cam.noise.getContext('2d');
    const img = nctx.createImageData(CAM_SIZE, CAM_SIZE);
    const rnd = seeded(12345);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rnd() * 256);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
  }

  function drawScene(n) {
    const S = CAM_SIZE;
    const ctx = cam.scene.getContext('2d');
    const horizon = S * 0.42;
    const sway = Math.sin(n * 0.045) * 14; // the "camera" turns a little

    const wall = ctx.createLinearGradient(0, 0, 0, horizon);
    wall.addColorStop(0, '#39464f');
    wall.addColorStop(1, '#7c8a92');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, S, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, S);
    floor.addColorStop(0, '#4b4a45');
    floor.addColorStop(1, '#8f8a7d');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, S, S - horizon);

    // Shelves on both sides and a door at the end of the aisle.
    ctx.fillStyle = '#2a3238';
    ctx.fillRect(sway - 30, horizon - 70, 70, 76);
    ctx.fillRect(S - 44 + sway, horizon - 82, 80, 88);
    ctx.fillStyle = '#b9a069';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(sway - 26 + (i % 2) * 30, horizon - 64 + i * 17, 24, 12);
      ctx.fillRect(S - 38 + sway + (i % 2) * 32, horizon - 76 + i * 20, 26, 14);
    }
    ctx.fillStyle = '#1b2227';
    ctx.fillRect(S / 2 - 16 + sway, horizon - 44, 32, 44);
    ctx.fillStyle = '#d9c36a';
    ctx.fillRect(S / 2 - 16 + sway, horizon - 48, 32, 5);

    // Floor lines coming towards the viewer: the robot walks forward.
    ctx.strokeStyle = '#d8d2c2';
    ctx.lineWidth = 1.5;
    const phase = (n * 0.035) % 1;
    for (let k = 0; k < 7; k++) {
      const d = (k + phase) / 7;
      const y = horizon + (S - horizon) * d * d;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(S, y);
      ctx.stroke();
    }
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath();
      ctx.moveTo(S / 2 + sway + k * 10, horizon);
      ctx.lineTo(S / 2 + k * 90, S);
      ctx.stroke();
    }

    // Something that crosses the picture, to judge smoothness by eye.
    ctx.fillStyle = '#e2572f';
    ctx.beginPath();
    ctx.arc(((n * 5) % (S + 60)) - 30, horizon + 46, 13, 0, Math.PI * 2);
    ctx.fill();

    // Grain.
    ctx.globalAlpha = 0.16;
    const nx = (n * 37) % S;
    const ny = (n * 53) % S;
    ctx.drawImage(cam.noise, nx, ny);
    ctx.drawImage(cam.noise, nx - S, ny);
    ctx.drawImage(cam.noise, nx, ny - S);
    ctx.drawImage(cam.noise, nx - S, ny - S);
    ctx.globalAlpha = 1;

    // Frame counter burnt into the picture: a skipped number is a lost frame.
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(4, 44, 78, 18); // clear of the controls laid over the picture
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('f ' + String(n).padStart(6, '0'), 8, 54);
  }

  function encodeScene() {
    return new Promise((resolve, reject) => {
      if (!cam.scene.toBlob) {
        reject(new Error('canvas.toBlob is missing'));
        return;
      }
      cam.scene.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', CAM_QUALITY);
    });
  }

  function showUrl(url) {
    camImg.src = url;
    if (camImg.decode) return camImg.decode();
    return new Promise((resolve, reject) => {
      camImg.onload = resolve;
      camImg.onerror = () => reject(new Error('image load failed'));
    });
  }

  async function cameraLoop(token) {
    try {
      camSetup();
      if (cam.replay && cam.frames.length !== REPLAY_FRAMES) {
        cam.frames = [];
        for (let i = 0; i < REPLAY_FRAMES; i++) {
          drawScene(i);
          const blob = await encodeScene();
          if (cam.token !== token) return;
          cam.frames.push(blob);
          cam.note = 'preparing ' + (i + 1) + '/' + REPLAY_FRAMES;
        }
        cam.note = '';
      }
      let due = performance.now();
      while (cam.token === token) {
        const t0 = performance.now();
        let blob;
        if (cam.replay) {
          blob = cam.frames[cam.frameNo % REPLAY_FRAMES];
        } else {
          drawScene(cam.frameNo);
          blob = await encodeScene();
        }
        cam.frameNo++;
        const t1 = performance.now();
        if (cam.token !== token) return;

        const url = URL.createObjectURL(blob);
        const old = cam.url;
        cam.url = url;
        let shown = true;
        try {
          await showUrl(url);
          await nextFrame();
        } catch (err) {
          shown = false;
        } finally {
          if (old) URL.revokeObjectURL(old);
        }
        if (cam.token !== token) return;
        if (!shown) { // a frame that could not be decoded is counted, not hidden
          cam.failed++;
          await sleep(20);
          continue;
        }
        const t2 = performance.now();

        cam.stamps.push(t2);
        if (cam.stamps.length > 120) cam.stamps.splice(0, cam.stamps.length - 120);
        cam.kb = blob.size / 1024;
        cam.makeMs = smooth(cam.makeMs, t1 - t0);
        cam.showMs = smooth(cam.showMs, t2 - t1);

        const period = 1000 / cam.target;
        due += period;
        const now = performance.now();
        if (due < now - period) due = now; // running behind: do not burst
        if (due - now > 1) await sleep(due - now);
      }
    } catch (err) {
      if (cam.token === token) cam.note = 'camera error: ' + (err && err.message ? err.message : err);
    }
  }

  function paintCameraHud() {
    const now = performance.now();
    const recent = cam.stamps.filter((s) => s > now - 2000);
    let fps = 0;
    if (recent.length >= 2 && now - recent[recent.length - 1] < 700) {
      fps = ((recent.length - 1) * 1000) / (recent[recent.length - 1] - recent[0]);
    }
    const l1 = fps.toFixed(1).padStart(4) + ' fps (target ' + cam.target + ') · ' + cam.kb.toFixed(1) + ' kB';
    const l2 = cam.note || ('make ' + cam.makeMs.toFixed(1) + ' ms · show ' + cam.showMs.toFixed(1) + ' ms · ' +
      (cam.replay ? 'replay' : 'live') + (cam.failed ? ' · failed ' + cam.failed : ''));
    setText(camHud, l1 + '\n' + l2);
    for (const b of PAGES.camera.querySelectorAll('[data-fps]')) {
      const on = String(Number(b.dataset.fps) === cam.target);
      if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
    }
    setText($('cam-src'), cam.replay ? 'Source: replay' : 'Source: live');
  }

  function cameraStart() {
    cam.token++;
    cam.stamps = [];
    cam.makeMs = cam.showMs = 0;
    cam.note = '';
    cameraLoop(cam.token);
  }

  function cameraStop() {
    cam.token++;
    if (cam.url) URL.revokeObjectURL(cam.url);
    cam.url = '';
    cam.frames = [];
    camImg.removeAttribute('src');
  }

  // ------------------------------------------------------------------
  // Input. Activation is the ordinary click that the browser raises for
  // Enter on a focused control. Key events are only recorded, never
  // consumed (except with the opt-in ?arrows=1 desktop aid below).
  // ------------------------------------------------------------------

  document.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    dg.actId = b.id || 'button';
    dg.actN++;
    if (b.dataset.act === 'back' || b.id === 'nm-cancel') goBack();
    else if (b.classList.contains('frow')) openPage({ screen: 'finding', n: rows.find((r) => r.el === b).n }, b.id);
    else if (b.id === 'm-map') openPage({ screen: 'map' }, b.id);
    else if (b.id === 'm-camera') openPage({ screen: 'camera' }, b.id);
    else if (b.id === 'm-new') openPage({ screen: 'new', step: 1, text: '' }, b.id);
    else if (b.id === 'nm-next') newMissionNext();
    else if (b.id === 'nm-start') {
      pendingToast = 'Demo: nothing was sent';
      goBack();
    } else if (b.dataset.fps) {
      cam.target = Number(b.dataset.fps);
      cam.stamps = [];
    } else if (b.id === 'cam-src') {
      cam.replay = !cam.replay;
      cameraStart();
    }
    tick();
  });

  const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  window.addEventListener('keydown', (e) => {
    dg.keyN++;
    dg.keys.push(e.key && e.key !== 'Unidentified' ? e.key : (e.code || 'code') + '/' + e.keyCode);
    if (dg.keys.length > 6) dg.keys.shift();
    if (ARROWS[e.key]) {
      // Did this arrow key move focus? (first number: yes, second: no)
      const before = document.activeElement;
      setTimeout(() => {
        if (document.activeElement !== before) dg.arrowMoved++;
        else dg.arrowStuck++;
        paintDiag();
      }, 0);
    }
    paintDiag();
  }, true);

  window.addEventListener('keydown', (e) => {
    // Desktop stand-in for the glasses' Back gesture.
    if (e.key === 'Escape' && cur.screen !== 'mission') goBack();
  });

  // Focus that disappears without a navigation is the fault this prototype
  // looks for; it is counted as "lost" in the diagnostics.
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (!nav.busy && document.hasFocus() && (!a || a === document.body)) {
        dg.lost++;
        paintDiag();
      }
    }, 0);
  });
  document.addEventListener('focusin', paintDiag);

  // Opt-in desktop aid (?arrows=1): move focus to the nearest control in the
  // arrow's direction. Off by default so that on the glasses, and in a desktop
  // browser started with spatial navigation switched on, only the browser
  // moves focus.
  if (PAGE_ARROWS) {
    const gap = (a1, a2, b1, b2) => Math.max(0, b1 - a2, a1 - b2);
    window.addEventListener('keydown', (e) => {
      const dir = ARROWS[e.key];
      if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement;
      if (active === nmInput && dir[0] !== 0 && nmInput.value !== '') return; // caret keys
      const all = Array.from(PAGES[cur.screen].querySelectorAll('button, input, select, textarea, a[href]'))
        .filter((el) => !el.disabled && el.getClientRects().length);
      if (!all.length) return;
      e.preventDefault();
      if (!all.includes(active)) {
        all[0].focus();
        return;
      }
      const r = active.getBoundingClientRect();
      let best = null;
      let bestScore = Infinity;
      for (const el of all) {
        if (el === active) continue;
        const q = el.getBoundingClientRect();
        let ahead;
        let aside;
        if (dir[0]) {
          ahead = dir[0] > 0 ? q.left - r.right : r.left - q.right;
          aside = gap(r.top, r.bottom, q.top, q.bottom);
        } else {
          ahead = dir[1] > 0 ? q.top - r.bottom : r.top - q.bottom;
          aside = gap(r.left, r.right, q.left, q.right);
        }
        if (ahead < -2) continue;
        const score = Math.max(0, ahead) + 3 * aside;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (best) best.focus();
    });
  }

  // ------------------------------------------------------------------
  // The clock: twice a second, repaint what the visible page shows.
  // ------------------------------------------------------------------

  function tick() {
    const st = stateAt(clock());
    if (cur.screen === 'mission') {
      paintMission(st);
    } else if (cur.screen === 'map') {
      setText($('map-cap'), 'Map · ' + ROBOT + ' · ' + st.findings.length + ' findings');
      drawMap(bigMap, st, true);
    } else if (cur.screen === 'camera') {
      paintCameraHud();
    }
    paintDiag();
  }

  diagEl.hidden = !DEBUG;
  window.addEventListener('resize', () => {
    if (cur.screen === 'finding') paintFinding(cur.n);
    tick();
  });
  window.addEventListener('online', paintDiag);
  window.addEventListener('offline', paintDiag);

  // Start: Mission is the root entry. After a reload on a sub-page the
  // browser hands back that entry's state, and it is shown again.
  const initial = history.state && PAGES[history.state.screen] ? history.state : HOME;
  if (initial === HOME) history.replaceState(HOME, '');
  render(initial);
  setInterval(tick, 500);
})();
