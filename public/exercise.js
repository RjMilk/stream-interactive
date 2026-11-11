// Физические челленджи: экран закрыт, пока камера не насчитает нужное число повторов.
// Подключается из overlay.html после основного скрипта и пользуется его layer / remove / esc / MODE / EFFECTS.
//
// Состояние ведёт только окно поверх игры (mode=screen): оно смотрит в камеру, считает повторы
// и публикует состояние на сервер. Источник OBS (mode=obs) и панель только показывают его.

// Точки скелета MediaPipe Pose: 11/12 плечи, 13/14 локти, 15/16 кисти, 23/24 таз, 25/26 колени, 27/28 стопы
const EXERCISES = {
  pushups: { title: '💪 ОТЖИМАНИЯ', word: 'отжиманий', joints: [[11, 13, 15], [12, 14, 16]], down: 100, up: 150, torso: 'flat', pose: 'Прими упор лёжа боком к камере' },
  squats:  { title: '🦵 ПРИСЕДАНИЯ', word: 'приседаний', joints: [[23, 25, 27], [24, 26, 28]], down: 105, up: 160, torso: 'upright', pose: 'Встань прямо, в полный рост' },
};
const BONES = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
const MIN_VISIBILITY = 0.5;

// Угол в суставе b (градусы) между отрезками b→a и b→c
function jointAngle(a, b, c) {
  const d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  const deg = Math.abs(d * 180 / Math.PI);
  return deg > 180 ? 360 - deg : deg;
}

// Счётчик повторов. feed(landmarks) принимает скелет одного кадра и возвращает
// { rep: засчитан ли повтор на этом кадре, hint: подсказка стримеру }.
// Повтор = сустав согнулся сильнее `down`, затем разогнулся больше `up`.
function makeCounter(kind) {
  const cfg = EXERCISES[kind];
  let phase = 'up', smooth = null;
  return {
    feed(lm) {
      const vis = (ids) => ids.reduce((s, i) => s + (lm[i].visibility ?? 0), 0) / ids.length;
      const side = vis(cfg.joints[0]) >= vis(cfg.joints[1]) ? 0 : 1;   // берём ту сторону тела, что лучше видна
      const ids = cfg.joints[side];
      if (vis(ids) < MIN_VISIBILITY) return { rep: false, hint: 'Камера не видит тебя целиком' };

      // Поза: корпус лежит (отжимания) или стоит (приседания). Если таз не виден, не придираемся.
      const sh = lm[11 + side], hip = lm[23 + side];
      if ((sh.visibility ?? 0) > MIN_VISIBILITY && (hip.visibility ?? 0) > MIN_VISIBILITY) {
        const flat = Math.abs(sh.y - hip.y) < Math.abs(sh.x - hip.x);
        if (flat !== (cfg.torso === 'flat')) return { rep: false, hint: cfg.pose };
      }

      const a = jointAngle(lm[ids[0]], lm[ids[1]], lm[ids[2]]);
      smooth = smooth === null ? a : smooth * 0.5 + a * 0.5;
      if (phase === 'up' && smooth < cfg.down) phase = 'down';
      else if (phase === 'down' && smooth > cfg.up) { phase = 'up'; return { rep: true, hint: 'Засчитано!' }; }
      return { rep: false, hint: phase === 'up' ? 'Вниз ⬇' : 'Вверх ⬆' };
    },
  };
}

// ---------- Распознавание позы (MediaPipe, всё локально) ----------
let landmarkerPromise = null;
function loadLandmarker() {
  landmarkerPromise ??= (async () => {
    const vision = await import('/vendor/mediapipe/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    return vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1,
    });
  })().catch((e) => { landmarkerPromise = null; throw e; });
  return landmarkerPromise;
}

// Открывает камеру. Если в панели выбрана камера (часть названия), ищет её среди устройств.
async function openCamera() {
  const { camera } = await fetch('/api/camera', { method: 'POST', body: '{}' }).then((r) => r.json());
  const want = { width: 640, height: 480 };
  let stream = await navigator.mediaDevices.getUserMedia({ video: want });
  if (camera && !stream.getVideoTracks()[0].label.includes(camera)) {
    const dev = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.label.includes(camera));
    if (dev) {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...want, deviceId: { exact: dev.deviceId } } });
    }
  }
  return stream;
}

// ---------- Состояние ----------
const ex = { cur: null, queue: [], debt: {} };   // cur: { kind, total, done, user, el }
const debtEl = document.createElement('div');
debtEl.className = 'ex-debt';
document.body.appendChild(debtEl);

const debtText = (debt) => Object.entries(debt).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${EXERCISES[k].word}`).join(' + ');

function publish() {
  const state = { cur: ex.cur && { kind: ex.cur.kind, total: ex.cur.total, done: ex.cur.done, user: ex.cur.user }, debt: ex.debt };
  renderDebt(state.debt);
  fetch('/api/exercise-state', { method: 'POST', body: JSON.stringify({ state }) }).catch(() => {});
}
function renderDebt(debt) {
  const text = debtText(debt);
  debtEl.textContent = text ? `📝 Долг: ${text}` : '';
  debtEl.style.display = text ? '' : 'none';
}

// Рисует заставку челленджа: заголовок, счётчик, подсказку
function renderCover(el, st, hint) {
  const cfg = EXERCISES[st.kind];
  if (!el.querySelector('.ex')) {
    el.classList.add('ex-cover');
    el.innerHTML = `<div class="ex"><div class="ex-t"></div><div class="ex-n"></div><canvas class="ex-cam" width="640" height="480"></canvas>
      <div class="ex-h"></div><div class="ex-u"></div></div>`;
    if (MODE !== 'screen') el.querySelector('.ex-cam').remove();
  }
  el.querySelector('.ex-t').textContent = cfg.title;
  el.querySelector('.ex-n').innerHTML = `<b>${st.done}</b> / ${st.total}`;
  if (hint !== undefined) el.querySelector('.ex-h').textContent = hint;
  el.querySelector('.ex-u').textContent = `${st.user ? 'от ' + st.user + ' · ' : ''}экран откроется после ${st.total} ${cfg.word}`;
}

function enqueue(kind, reps, user) {
  const same = ex.cur?.kind === kind ? ex.cur : ex.queue.find((q) => q.kind === kind);
  if (same) { same.total += reps; if (same === ex.cur) renderCover(ex.cur.el, ex.cur); }
  else ex.queue.push({ kind, total: reps, done: 0, user });
  if (!ex.cur) startNext(); else publish();
}

function startNext() {
  ex.cur = ex.queue.shift() || null;
  if (ex.cur) startChallenge(ex.cur);
  publish();
}

function addRep() {
  const c = ex.cur;
  if (!c || c.done >= c.total) return;
  c.done++;
  renderCover(c.el, c);
  publish();
  if (c.done >= c.total) {
    c.el.querySelector('.ex-h').textContent = '✅ ГОТОВО!';
    setTimeout(() => finish(c), 1500);
  }
}

function finish(c) {
  if (ex.cur !== c) return;
  ex.cur = null;          // до remove: иначе _cleanup примет это за «панику» и сбросит очередь
  remove(c.el);
  startNext();
}

// Заставка + камера + цикл распознавания для одного челленджа
function startChallenge(c) {
  const el = layer(900, false);   // страховка: через 15 минут экран откроется сам
  c.el = el;
  renderCover(el, c, 'Включаю камеру…');
  let stream = null, alive = true;
  el._cleanup = () => {
    alive = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ex.cur === c) { ex.cur = null; ex.queue = []; publish(); }   // убрано «паникой» или по таймауту
  };

  (async () => {
    const counter = makeCounter(c.kind);
    const canvas = el.querySelector('.ex-cam'), ctx = canvas.getContext('2d');
    const video = document.createElement('video');
    video.muted = true;
    stream = await openCamera();
    if (!alive) return stream.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    await video.play();
    const landmarker = await loadLandmarker();
    let last = 0;
    const tick = (t) => {
      if (!alive) return;
      el._raf = requestAnimationFrame(tick);
      if (t - last < 66 || video.readyState < 2) return;   // ~15 кадров в секунду хватает и не грузит игру
      last = t;
      const pose = landmarker.detectForVideo(video, t).landmarks[0];
      const W = canvas.width, H = canvas.height;
      ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, -W, 0, W, H); ctx.restore();   // зеркально, как в зеркале
      if (!pose) { el.querySelector('.ex-h').textContent = 'Камера тебя не видит'; return; }
      ctx.strokeStyle = '#ff2f86'; ctx.lineWidth = 5;
      for (const [a, b] of BONES) {
        if ((pose[a].visibility ?? 0) < MIN_VISIBILITY || (pose[b].visibility ?? 0) < MIN_VISIBILITY) continue;
        ctx.beginPath(); ctx.moveTo((1 - pose[a].x) * W, pose[a].y * H); ctx.lineTo((1 - pose[b].x) * W, pose[b].y * H); ctx.stroke();
      }
      if (c.done >= c.total) return;
      const r = counter.feed(pose);
      el.querySelector('.ex-h').textContent = r.hint;
      if (r.rep) addRep();
    };
    el._raf = requestAnimationFrame(tick);
  })().catch((e) => {
    console.error('exercise', e);
    if (alive) el.querySelector('.ex-h').textContent = 'Камера недоступна — засчитывай повторы вручную (Ctrl+Shift+F10)';
  });
}

// ---------- Вход: эффект из правил и команды с сервера ----------
// Эффект: { type: "exercise", exercise: "pushups" | "squats", count: 5 }  либо  per/max (повторы = сумма / per),
// deferred: true — не закрывать экран сразу, а записать в долг (для онлайн-матчей).
EFFECTS.exercise = (p, ev, n) => {
  if (MODE !== 'screen') return;
  const kind = EXERCISES[p.exercise] ? p.exercise : 'pushups';
  const reps = Math.max(1, Math.round(p.count ?? (p.per ? n : 5)));
  if (p.deferred) {
    ex.debt[kind] = (ex.debt[kind] || 0) + reps;
    EFFECTS.toast({ text: `📝 ${ev.user || 'Зритель'}: +${reps} ${EXERCISES[kind].word} в долг`, duration: 5 });
    publish();
  } else enqueue(kind, reps, ev.user);
};

// Команды: rep (+1 вручную), skip (снять текущий), start (начать отработку долга), forgive (списать долг)
const COMMANDS = {
  rep: addRep,
  skip() { if (ex.cur) finish(ex.cur); },
  start() { const debt = ex.debt; ex.debt = {}; for (const [k, n] of Object.entries(debt)) if (n > 0) enqueue(k, n, ''); publish(); },
  forgive() { ex.debt = {}; publish(); },
};

let obsCover = null;
function onExerciseMessage(msg) {
  if (MODE === 'screen') {
    if (msg.kind === 'exercise' && COMMANDS[msg.cmd]) COMMANDS[msg.cmd]();
    return;
  }
  if (msg.kind !== 'exstate') return;
  // Источник OBS: просто показывает то, что прислало окно стримера
  renderDebt(msg.state.debt || {});
  if (!msg.state.cur) { if (obsCover) { remove(obsCover); obsCover = null; } return; }
  if (!obsCover || !layers.has(obsCover)) obsCover = layer(900, false);
  renderCover(obsCover, msg.state.cur, '');
}
window.__exercise = { ex, makeCounter, jointAngle, loadLandmarker, EXERCISES };
