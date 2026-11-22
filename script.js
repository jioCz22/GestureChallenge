"use strict";

/* =========================================================
   GESTURECHALLENGE — MOTOR PRINCIPAL
   (detección 3D normalizada, confirmación por votos, guía al usuario,
   sonidos, animaciones y referencia acoplada a la cámara en móvil)
========================================================= */

/* 1. CONFIGURACIÓN */
const $ = id => document.getElementById(id);
const STORE = "gesturechallenge_lsm_progress_v1";

const DEF = {
  done: [], best: 0, points: 0, levels: [],
  mastery: {}, words: [], phrases: [],
  streak: 0, lastDay: "", history: [],
  badges: [], sound: true, landmarks: false, v2: 0, v3: 0
};

let data, lv = 1, idx = 0, step = 0;
let full = false, phase = "idle", left = 0;
let clock = null, score = 0, quiz = null, qTimer = null;
let stream = null, camOn = false;
let lm = null, MP = null, du = null;
let det = 0, lastT = 0, hand = false, actx = null;
let detErr = 0, useCPU = false, lastVT = -1, drawn = false, wake = null;
let onLearn = true;
let lvGain = 0;   /* puntos ganados en el nivel actual (para la pantalla de nivel completado) */
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const DEBUG = /debug/i.test(location.hash);   /* añade #debug a la URL para ver los valores internos */


/* 2. VALIDACIÓN DE DATA.JS */
function validateData() {
  const present = {
    LEVELS: typeof LEVELS !== "undefined",
    STAGES: typeof STAGES !== "undefined",
    STAGE_LV: typeof STAGE_LV !== "undefined",
    RES: typeof RES !== "undefined",
    ALL: typeof ALL !== "undefined",
    BADGES: typeof BADGES !== "undefined",
    SHAPES: typeof SHAPES !== "undefined"
  };
  const missing = Object.keys(present).filter(name => !present[name]);

  if (missing.length) {
    document.body.innerHTML = `
      <main style="max-width:700px;margin:80px auto;padding:30px;color:white;
      font-family:Arial;background:#111a2c;border-radius:18px">
        <h1>Error al cargar GestureChallenge</h1>
        <p>Faltan datos en data.js:</p>
        <ul>${missing.map(x => `<li>${x}</li>`).join("")}</ul>
        <p>Comprueba que data.js se cargue antes de script.js.</p>
      </main>`;
    throw new Error("No se pudo inicializar data.js.");
  }

  if (!Array.isArray(LEVELS) || LEVELS.length !== 15)
    throw new Error("LEVELS debe contener 15 niveles.");

  if (!Array.isArray(ALL) || ALL.length !== 26 || ALL.includes("Ñ"))
    throw new Error("ALL debe contener 26 letras (sin Ñ).");

  if (!Array.isArray(STAGES) || !Array.isArray(STAGE_LV) || !RES)
    throw new Error("Las estructuras de data.js no son válidas.");

  LEVELS.forEach((level, i) => {
    if (!Array.isArray(level.items) || !level.items.length)
      throw new Error(`El nivel ${i + 1} no tiene elementos.`);

    if (!["letters", "words", "phrases"].includes(level.type))
      throw new Error(`Tipo inválido en el nivel ${i + 1}.`);

    if (!Number.isInteger(level.stage) || !STAGES[level.stage])
      throw new Error(`Etapa inválida en el nivel ${i + 1}.`);
  });
}


/* 3. PROGRESO Y ALMACENAMIENTO */
function load() {
  let saved;

  try {
    saved = JSON.parse(localStorage.getItem(STORE));
  } catch (error) {
    console.warn("No se pudo leer el progreso:", error);
  }

  const d = { ...DEF, ...(saved && typeof saved === "object" ? saved : {}) };

  ["done", "levels", "words", "phrases", "history", "badges"].forEach(key => {
    if (!Array.isArray(d[key])) d[key] = [];
  });

  if (!d.mastery || typeof d.mastery !== "object") d.mastery = {};

  if (!d.v2) {
    LEVELS.slice(0, 5).forEach(level => {
      if (level.items.every(item => d.done.includes(item)) && !d.levels.includes(level.n))
        d.levels.push(level.n);
    });
    d.v2 = 1;
  }

  /* v3: se eliminó la Ñ (27 → 26 letras). Se conserva todo lo demás: puntos, racha,
     niveles superados, palabras, frases e insignias. */
  if (d.v3 !== 1) {
    d.done = [...new Set(d.done.filter(letter => ALL.includes(letter)))];
    Object.keys(d.mastery).forEach(key => { if (key.length === 1 && !ALL.includes(key)) delete d.mastery[key]; });
    d.history = d.history.filter(entry => !(entry && entry.w === "Ñ"));
    d.v3 = 1;
  }

  return d;
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch (error) {
    console.error("Error guardando progreso:", error);
    toast("No se pudo guardar el progreso.");
  }
}

/* Fecha LOCAL (antes se usaba UTC y la racha fallaba por la noche en México) */
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;


/* 4. UTILIDADES */
const L = n => LEVELS[n - 1];
const cur = () => L(lv)?.items?.[idx];

const list = level => ({
  letters: data.done,
  words: data.words,
  phrases: data.phrases
}[level.type] || []);

const isDone = (level, item) => list(level).includes(item);
const allDone = level => level.items.every(item => isDone(level, item));
const passed = n => data.levels.includes(n);
const unlocked = n => n === 1 || passed(n - 1) || passed(n);

const shuffle = array => array
  .map(item => [Math.random(), item])
  .sort((a, b) => a[0] - b[0])
  .map(item => item[1]);

function spell(word) {
  return [...String(word).toUpperCase().replace(/[ÁÉÍÓÚÜ]/g, char =>
    "AEIOUU"["ÁÉÍÓÚÜ".indexOf(char)]
  )];
}

function steps() {
  const level = L(lv);
  return !level || level.type === "phrases" ? ["·"] : spell(cur());
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[char]);
}

/* Solo escribe en el DOM cuando el valor cambió: evita repintados y lag */
function setText(id, value) {
  const el = $(id);
  const text = String(value);
  if (el && el.textContent !== text) el.textContent = text;
}

function setHTML(el, html) {
  if (!el || el._h === html) return false;
  el._h = html;
  el.innerHTML = html;
  return true;
}

const narrow = () => window.matchMedia("(max-width:900px)").matches;

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
}

function fb(message, color = "") {
  const el = $("feedback");
  if (!el) return;
  if (el.textContent !== message) el.textContent = message;
  const cls = "feedback " + color;
  if (el.className !== cls) el.className = cls;

  /* El mismo mensaje se muestra sobre la cámara: en el teléfono se ve sin desplazarse */
  const hint = $("camHint");
  if (hint) {
    const text = camOn ? message : "";
    if (hint.textContent !== text) hint.textContent = text;
    const hc = "cam-hint " + color;
    if (hint.className !== hc) hint.className = hc;
  }
}

/* Precarga las imágenes del nivel para que el cambio de letra sea instantáneo */
const preloaded = new Set();
function preload(keys) {
  keys.forEach(key => {
    const src = RES[key]?.img;
    if (!src || preloaded.has(src)) return;
    preloaded.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });
}


/* 5. REFERENCIAS VISUALES */
function refHTML(key) {
  const resource = RES[key];

  if (!resource) return `<div class="empty">No se encontró una referencia para «${esc(key)}».</div>`;

  if (resource.video) {
    return `<video src="${esc(resource.video)}" controls playsinline preload="metadata"></video>`;
  }

  if (resource.img) {
    return `
      <img src="${esc(resource.img)}" alt="Referencia de ${esc(key)}"
        decoding="async"
        onerror="this.style.display='none';this.nextElementSibling.hidden=false">
      <div class="empty" hidden>No se pudo cargar la imagen de ${esc(key)}.</div>`;
  }

  return `<div class="empty">${esc(resource.desc || "Referencia pendiente de validación.")}</div>`;
}

function hasRef(key) {
  const resource = RES[key];
  return Boolean(resource?.img?.trim() || resource?.video?.trim());
}


/* 6. NIVELES */
function renderLevels() {
  const box = $("levels");

  const changed = setHTML(box, STAGES.map((stage, i) => `
    <div class="stage-col">
      <h4>${esc(stage).toUpperCase()}</h4>
      <div>
        ${STAGE_LV[i].map(number => {
          const open = unlocked(number);
          const done = passed(number);
          return `<button type="button"
            class="level-btn${number === lv ? " active" : ""}${done ? " ok" : ""}"
            data-n="${number}" ${open ? "" : "disabled"}
            aria-label="Nivel ${number}${done ? " superado" : ""}"
            title="${open ? esc(L(number).name) : "Supera el nivel anterior"}">${number}${done ? " ✓" : ""}</button>`;
        }).join("")}
      </div>
    </div>
  `).join(""));

  /* En móvil la tira es deslizable: centra la etapa activa */
  if (changed) {
    const col = box.querySelector(".level-btn.active")?.closest(".stage-col");
    if (col && box.scrollWidth > box.clientWidth + 4)
      box.scrollTo({ left: col.offsetLeft - (box.clientWidth - col.offsetWidth) / 2, behavior: "smooth" });
  }
}


/* 7. APRENDIZAJE */
function renderBase() {
  const level = L(lv);
  if (!level) return;

  idx = Math.max(0, Math.min(idx, level.items.length - 1));

  const item = cur();
  if (!item) return;

  const sequence = steps();
  const count = sequence.length;
  const currentLetter = sequence[Math.min(step, count - 1)];
  const completed = level.items.filter(x => isDone(level, x)).length;

  setText("stageName", STAGES[level.stage].toUpperCase());
  setText("levelTitle", `Nivel ${lv} · ${level.name}`);
  setText("goal", "Objetivo: " + level.goal);
  setText("itemCount", `${completed} / ${level.items.length}`);

  const targetHTML = level.type === "words"
    ? sequence.map((letter, i) =>
        i === step && (!full || phase === "run")
          ? `<span class="cur">${esc(letter)}</span>`
          : esc(letter)
      ).join("")
    : esc(item);

  setHTML($("target"), targetHTML);
  $("target").className = "target-letter" + (item.length > 5 ? " long" : "");

  const cameraLabel = {
    letters: "PRACTICA LA LETRA",
    words: `PALABRA · LETRA ${Math.min(step, count - 1) + 1}/${count}`,
    phrases: "PRACTICA LA FRASE"
  }[level.type];

  setHTML($("camTarget"), `<small>${cameraLabel}</small>${targetHTML}`);

  $("steps").hidden = level.type !== "words";
  const stepsHTML = level.type === "words"
    ? sequence.map((letter, i) => `
        <span class="chip ${i < step && !full ? "done" : ""} ${i === step ? "current" : ""}">
          ${esc(letter)}
        </span>`).join("")
    : "";
  setHTML($("steps"), stepsHTML);

  const refKey = level.type === "phrases" ? item : currentLetter;
  const resource = RES[refKey] || {};

  setHTML($("refBox"), refHTML(refKey));
  setText("refDesc", [
    resource.desc || "",
    ...(resource.tips || []),
    resource.variants?.length ? "Variantes: " + resource.variants.join(", ") : ""
  ].filter(Boolean).join(" "));

  setHTML($("itemList"), level.items.map((element, i) => `
    <button type="button"
      class="chip ${isDone(level, element) ? "done" : ""} ${i === idx ? "current" : ""}"
      data-k="${i}">${esc(element)}</button>
  `).join(""));

  $("levelBar").style.width = completed / level.items.length * 100 + "%";

  const canPractice = level.type !== "phrases" || hasRef(item);
  $("startBtn").hidden = phase === "run" || phase === "eval";
  $("startBtn").disabled = !canPractice;

  $("evalBox").hidden = phase !== "eval";
  $("quizBtn").hidden = level.type !== "letters";

  const refsExist = level.items.some(hasRef);
  $("quizBtn").disabled = !allDone(level) || passed(lv) || !refsExist;
  setText("quizBtn", passed(lv) ? "✓ Evaluación superada" : "Evaluación final");
  $("quizBtn").title = !allDone(level)
    ? "Practica todas las letras primero"
    : !refsExist ? "Faltan referencias visuales" : "";

  $("listenBtn").hidden = !("speechSynthesis" in window);
  setText("timer", phase === "run" ? left + " s" : "");

  if (phase === "idle" && !canPractice)
    fb("Este contenido necesita una referencia validada. Revisa data.js → RES.", "warn");

  renderOverall();
}


/* 8. PROGRESO GENERAL */
function renderOverall() {
  const total = LEVELS.reduce((sum, level) => sum + level.items.length, 0);
  const completed = data.done.length + data.words.length + data.phrases.length;
  const percentage = total ? Math.min(100, Math.round(completed / total * 100)) : 0;

  $("overallBar").style.width = percentage + "%";
  $("mbBar").style.transform = `scaleX(${percentage / 100})`;
  setText("overallTxt", percentage + "%");
  setText("mbPct", percentage + "%");
  setText("sbPoints", data.points); setText("mbPoints", data.points);
  setText("sbStreak", data.streak); setText("mbStreak", data.streak);
  setText("sbLetters", data.done.length + "/" + ALL.length); setText("sbLevels", data.levels.length + "/15");
}


/* 9. CONTROL DE NIVELES */
function stopClock() {
  clearInterval(clock);
  clock = null;
}

function resetBase() {
  stopClock();
  phase = "idle";
  step = 0;
  full = false;
  left = 0;
  $("timer").textContent = "";
  $("evalBox").hidden = true;
}

function selectLevel(number) {
  if (!unlocked(number)) return;

  endQuiz();
  reset();
  lv = number;
  lvGain = 0;

  const level = L(number);
  idx = level.items.findIndex(item => !isDone(level, item));
  if (idx < 0) idx = 0;

  preload(level.type === "words"
    ? [...new Set(level.items.flatMap(spell))]
    : level.items);

  fb("Pulsa «Iniciar nivel» para comenzar.");
  renderLevels();
  render();
}

function pick(index) {
  endQuiz();
  reset();
  idx = index;
  fb("Pulsa «Iniciar nivel» para comenzar.");
  render();
}


/* 10. PRÁCTICA */
function startPractice() {
  const level = L(lv);
  if (!level || !cur()) return;

  const sequence = steps();

  if (level.type === "phrases" && !hasRef(cur())) {
    fb("Falta una referencia verificada para practicar esta frase.", "warn");
    return;
  }

  stopClock();
  phase = "run";
  left = full ? 4 : camOn ? 8 : 15;
  if (full) step = 0;

  fb(full
    ? "Deletrea cada letra cuando se resalte."
    : camOn
      ? "Forma la seña frente a la cámara y mantén la posición."
      : "Cámara apagada: practica con la referencia.");

  render();

  clock = setInterval(() => {
    if (data.landmarks && camOn && lm && !hand) {
      fb("No veo tu mano. Colócala dentro del cuadro.", "warn");
      return;
    }

    left--;

    if (left <= 0) {
      if (full && step < sequence.length - 1) {
        step++;
        left = 4;
        sfx("step");
        fb("Siguiente letra.");
      } else {
        stopClock();
        phase = "eval";
        sfx("warn");
        fb("Tiempo terminado. Haz tu autoevaluación.");
      }
    }

    render();
  }, 1000);
}

function evalYesBase() {
  const level = L(lv);
  const sequence = steps();

  if (level.type === "words" && !full) {
    step++;
    phase = "idle";
    sfx("step");

    if (step >= sequence.length) {
      full = true;
      step = 0;
      fb("¡Letras listas! Ahora deletrea la palabra completa.", "ok");
    } else {
      fb("Muy bien. Sigue con la siguiente letra.", "ok");
    }

    render();
    return;
  }

  complete();
}

function evalNoBase() {
  phase = "idle";
  if (full) step = 0;
  fb("Repite la práctica observando la referencia.");
  render();
}


/* 11. COMPLETAR Y RECOMPENSAR */
function completeBase() {
  const level = L(lv);
  const item = cur();
  if (!level || !item) return;

  const first = !isDone(level, item);
  const points = first ? 100 : 20;

  if (first) list(level).push(item);

  data.points += points;
  score += points;
  data.best = Math.max(data.best, score);

  if (level.type === "letters")
    data.mastery[item] = Math.min(100, (data.mastery[item] || 0) + 34);

  const today = dayKey();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yesterday = dayKey(yest);

  if (data.lastDay !== today) {
    data.streak = data.lastDay === yesterday ? data.streak + 1 : 1;
    data.lastDay = today;
  }

  data.history.unshift({ t: Date.now(), w: item, p: points });
  data.history.length = Math.min(data.history.length, 40);

  if (level.type !== "letters" && allDone(level) && !passed(lv))
    data.levels.push(lv);

  checkBadges();
  save();
  reset();

  const kind = level.type === "letters" ? "letter" : "word";
  const doneNow = level.items.filter(x => isDone(level, x)).length;
  lvGain += points;
  sfx(kind);
  celebrate(kind, item, points, `${doneNow} / ${level.items.length}`);

  fb(`¡Correcto! «${item}» completado. +${points} puntos.` +
    (level.type === "letters" && allDone(level) && !passed(lv)
      ? " Ya puedes tomar la evaluación final."
      : ""), "ok");

  renderLevels();
  render();
  renderStats();
}

function checkBadges() {
  BADGES.forEach(([id, name, description, condition]) => {
    if (!data.badges.includes(id) && typeof condition === "function" && condition(data)) {
      data.badges.push(id);
      toast("Insignia: " + name);
    }
  });
}


/* 12. VOZ Y EVALUACIÓN FINAL */
function listen() {
  if (!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(
    `Representa ${cur()}. Coloca la mano a la altura del pecho, dentro del cuadro y con buena luz. Compara su forma con la referencia.`
  );

  utterance.lang = "es-MX";
  speechSynthesis.speak(utterance);
}

function startQuiz() {
  const level = L(lv);
  if (!level || level.type !== "letters") return;

  const pool = level.items.filter(hasRef);

  if (!pool.length) {
    toast("Faltan referencias visuales para esta evaluación.");
    return;
  }

  if (!allDone(level)) return;

  reset();

  quiz = { q: shuffle(pool).slice(0, Math.min(5, pool.length)), i: 0, ok: 0 };
  $("lessonMain").hidden = true;
  $("quizBox").hidden = false;
  renderQuiz();
}

function renderQuiz() {
  if (!quiz) return;

  const key = quiz.q[quiz.i];
  const options = shuffle([
    key,
    ...shuffle(ALL.filter(letter => letter !== key && hasRef(letter))).slice(0, 3)
  ]);

  $("quizBox").innerHTML = `
    <span class="eyebrow">EVALUACIÓN FINAL · NIVEL ${lv}</span>
    <h2>¿Qué letra es? (${quiz.i + 1}/${quiz.q.length})</h2>
    <div class="ref">${refHTML(key)}</div>
    <div class="quiz-opts">
      ${options.map(option => `
        <button class="btn" type="button" data-o="${esc(option)}">${esc(option)}</button>
      `).join("")}
    </div>
    <button class="btn ghost" type="button" id="quizExit">Salir</button>
  `;

  $("quizExit").onclick = () => {
    endQuiz();
    render();
  };

  $("quizBox").querySelectorAll("[data-o]").forEach(button => {
    button.onclick = () => {
      if (!quiz) return;

      const correct = button.dataset.o === key;
      if (correct) quiz.ok++;
      sfx(correct ? "letter" : "warn");

      $("quizBox").querySelectorAll("[data-o]").forEach(option => {
        option.disabled = true;
        if (option.dataset.o === key) option.classList.add("right");
      });

      if (!correct) button.classList.add("wrong");

      qTimer = setTimeout(() => {
        if (!quiz) return;
        quiz.i++;
        quiz.i < quiz.q.length ? renderQuiz() : finishQuiz();
      }, 900);
    };
  });
}

function finishQuiz() {
  if (!quiz) return;

  const total = quiz.q.length;
  const required = Math.ceil(total * 0.8);
  const correct = quiz.ok >= required;
  const result = quiz.ok;

  const newly = correct && !passed(lv);

  if (newly) {
    data.levels.push(lv);
    data.points += 50;
    score += 50;
    data.best = Math.max(data.best, score);
    data.history.unshift({ t: Date.now(), w: `Evaluación nivel ${lv}`, p: 50 });
    checkBadges();
    save();
  }

  endQuiz();
  renderLevels();
  render();
  renderStats();

  fb(correct
    ? `¡Evaluación superada (${result}/${total})! Nivel desbloqueado.`
    : `Acertaste ${result}. Necesitas ${required} para avanzar. No te preocupes, repasa e inténtalo nuevamente.`,
    correct ? "ok" : "warn");

  if (newly) levelUp(lv, lvGain + 50);
}

function endQuiz() {
  clearTimeout(qTimer);
  quiz = null;
  $("quizBox").hidden = true;
  $("lessonMain").hidden = false;
}


/* 13. CÁMARA */
function setCamUI(on) {
  $("camera").style.display = on ? "block" : "none";
  $("cameraEmpty").hidden = on;
  setText("camStatus", on ? "CÁMARA ACTIVA" : "CÁMARA APAGADA");
  setText("camToggle", on ? "Apagar cámara" : "Activar cámara");
  setText("handState", on
    ? data.landmarks ? "Detector de manos: cargando…" : "Detector de manos: apagado"
    : "Detector de manos: apagado");
  if (!on) $("camBox").style.removeProperty("--ar");
  keepAwake(on);
  updateCamState();
}

/* La caja de la cámara toma la proporción real del video (horizontal o vertical),
   así el esqueleto dibujado coincide con la mano en cualquier teléfono. */
function syncAspect() {
  const video = $("camera");
  if (video.videoWidth && video.videoHeight)
    $("camBox").style.setProperty("--ar", (video.videoWidth / video.videoHeight).toFixed(4));
}

/* Evita que el teléfono apague la pantalla mientras practicas con la cámara */
async function keepAwake(on) {
  try {
    if (on && !wake && "wakeLock" in navigator) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    } else if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch (error) {
    wake = null;
  }
}

async function camStart() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Tu navegador no permite usar la cámara.");
    return;
  }

  $("camStatus").textContent = "SOLICITANDO PERMISO…";
  $("camToggle").disabled = true;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      audio: false
    });

    const video = $("camera");
    video.srcObject = stream;
    await video.play();
    syncAspect();

    smoother.reset();
    camOn = true;
    setCamUI(true);
    toast("Cámara activada");

    if (data.landmarks) startLM();
  } catch (error) {
    console.error("Error de cámara:", error);
    camStop();
    toast(error?.name === "NotAllowedError"
      ? "Permiso de cámara denegado. Revisa los permisos del navegador."
      : "No se pudo activar la cámara.");
  }

  $("camToggle").disabled = false;
}

function camStopBase() {
  cancelAnimationFrame(det);
  camOn = false;
  hand = false;

  stream?.getTracks().forEach(track => track.stop());
  stream = null;

  if ($("camera")) $("camera").srcObject = null;

  const canvas = $("overlay");
  if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

  setCamUI(false);
}


/* 14. MEDIAPIPE */
async function startLMBase() {
  if (!lm) {
    try {
      const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
      MP = await import(base + "/vision_bundle.mjs");

      const fileset = await MP.FilesetResolver.forVisionTasks(base + "/wasm");

      const make = delegate => MP.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      /* La GPU hace la detección mucho más fluida; si falla, cae a CPU */
      try {
        lm = await make(useCPU ? "CPU" : "GPU");
      } catch (gpuError) {
        console.warn("GPU no disponible, usando CPU:", gpuError);
        useCPU = true;
        lm = await make("CPU");
      }
    } catch (error) {
      console.error("Error cargando MediaPipe:", error);
      data.landmarks = false;
      $("optLandmarks").checked = false;
      save();
      $("handState").textContent = "Detector no disponible";
      toast("No se pudo cargar el detector. Seguirás con autoevaluación.");
      return;
    }
  }

  if (camOn && data.landmarks) {
    du = null;
    lastT = 0;
    lastVT = -1;
    smoother.reset();
    cancelAnimationFrame(det);
    det = requestAnimationFrame(loop);
  }
}

function loop() {
  if (!camOn || !lm || !data.landmarks) return;

  det = requestAnimationFrame(loop);

  const now = performance.now();
  const video = $("camera");
  const gap = auto ? 45 : 110;               /* ~22 fps en práctica, ~9 en reposo */

  /* No gastar batería si no se ve la cámara (otra pestaña/sección) */
  if (document.hidden || !onLearn || now - lastT < gap || video.readyState < 2 || !video.videoWidth) return;
  if (video.currentTime === lastVT) return;  /* mismo fotograma: no repetir trabajo */

  lastT = now;
  lastVT = video.currentTime;

  const canvas = $("overlay");
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext("2d");

  let result;

  try {
    result = lm.detectForVideo(video, now);
    detErr = 0;
  } catch (error) {
    console.error("Error detectando mano:", error);
    if (++detErr >= 5 && !useCPU) {
      /* La GPU falló en este dispositivo: reiniciar el detector en CPU */
      useCPU = true;
      detErr = 0;
      cancelAnimationFrame(det);
      try { lm.close(); } catch (e) { /* nada */ }
      lm = null;
      toast("Ajustando el detector para tu dispositivo…");
      startLM();
    }
    return;
  }

  const raw = result.landmarks?.[0] || null;
  const rawWorld = result.worldLandmarks?.[0] || null;
  const aspect = video.videoWidth / video.videoHeight;

  hand = !!raw;
  window.GC_LAST_LANDMARKS = raw;

  /* Los puntos suavizados se usan para clasificar; los crudos, para dibujar */
  const sm = raw ? smoother.push(raw, rawWorld, aspect, now) : null;
  if (auto && phase === "auto") autoTick(sm, now, aspect);

  if (drawn) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; }

  if (raw && data.overlay !== false) {
    du = du || new MP.DrawingUtils(ctx);
    du.drawConnectors(raw, MP.HandLandmarker.HAND_CONNECTIONS, { color: "#7dd3fc", lineWidth: 3 });
    du.drawLandmarks(raw, { color: "#fff", radius: 3 });
    drawn = true;
  }

  if (!(auto && hand)) setText("handState", hand ? "Mano a la vista" : "Sin mano a la vista");

  updateCamState();
}


/* 15. ESTADÍSTICAS */
function renderStats() {
  if (!$("view-stats").classList.contains("active")) return;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("statCompleted", data.done.length + data.words.length + data.phrases.length);
  set("statLevels", data.levels.length + "/15");
  set("statPoints", data.points);
  set("statStreak", data.streak + "");
  set("statLetters", data.done.length + "/" + ALL.length);
  set("statWords", data.words.length);
  $("mastery").innerHTML = ALL.map(l => `<div><b>${esc(l)}</b>${data.mastery[l] || 0}%</div>`).join("");
  $("levelStats").innerHTML = LEVELS.map(level => {
    const c = level.items.filter(i => isDone(level, i)).length;
    return `<div class="level-stat"><b>Nivel ${level.n}</b><div class="progress-track"><div class="progress-fill" style="width:${c / level.items.length * 100}%"></div></div><span>${c}/${level.items.length}</span></div>`;
  }).join("");
  $("badges").innerHTML = BADGES.map(([id, name, desc]) => {
    const ok = data.badges.includes(id);
    return `<div class="badge-card ${ok ? "" : "locked"}"><span>${ok ? "●" : "○"}</span><strong>${esc(name)}</strong><p>${esc(desc)}</p></div>`;
  }).join("");
  $("history").innerHTML = data.history.length
    ? data.history.slice(0, 15).map(h => `<div class="history-item"><span>${esc(h.w)}</span><span>${new Date(h.t).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })} · +${h.p} pts</span></div>`).join("")
    : '<p class="muted">Aún no hay prácticas. Pulsa «Iniciar nivel» para comenzar.</p>';
}


/* 16. GUÍA DEL ABECEDARIO */
function guideShow(letter) {
  document.querySelectorAll(".alphabet-cell").forEach(button => {
    button.classList.toggle("selected", button.dataset.l === letter);
  });

  const resource = RES[letter] || {};

  $("guideDetail").innerHTML = `
    <div class="ref">${refHTML(letter)}</div>
    <div>
      <h2>Letra ${esc(letter)}</h2>
      <p class="muted">${esc(resource.desc || "Todavía no hay una descripción disponible.")}</p>
    </div>`;
}

function renderGuide() {
  setText("guideCount", ALL.length + " letras");
  $("alphabetGrid").innerHTML = ALL.map(letter => `
    <button type="button" class="alphabet-cell"
      data-l="${esc(letter)}" aria-label="Ver letra ${esc(letter)}">
      ${esc(letter)}
    </button>
  `).join("");

  $("alphabetGrid").querySelectorAll("button").forEach(button => {
    button.onclick = () => guideShow(button.dataset.l);
  });

  guideShow("A");
}


/* 17. NAVEGACIÓN */
function view(section) {
  document.querySelectorAll("button[data-view]").forEach(b => {
    const on = b.dataset.view === section;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  ["learn", "stats", "guide"].forEach(n => $("view-" + n).classList.toggle("active", n === section));
  onLearn = section === "learn";
  if (!onLearn && ["run", "eval", "auto"].includes(phase)) {
    reset(); fb("Práctica pausada al cambiar de sección.", "warn"); render();
  }
  if (section === "stats") renderStats();
  window.scrollTo(0, 0);
}


/* 18. EVENTOS */
function syncSound() {
  $("soundToggle").checked = data.sound;
}

function bindEvents() {
  document.querySelectorAll("button[data-view]").forEach(button => {
    button.onclick = () => view(button.dataset.view);
  });

  /* Un solo listener por lista (en vez de uno por botón en cada render) */
  $("levels").addEventListener("click", event => {
    const button = event.target.closest(".level-btn");
    if (!button || button.disabled) return;
    selectLevel(Number(button.dataset.n));
    if (narrow()) $("lessonMain").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("itemList").addEventListener("click", event => {
    const button = event.target.closest("button[data-k]");
    if (button) pick(Number(button.dataset.k));
  });

  $("camera").addEventListener("resize", syncAspect);
  $("tabSettings").onclick = () => $("openSettings").click();

  /* Tocar fuera de la hoja de ajustes la cierra */
  $("settings").addEventListener("click", event => {
    const r = $("settings").getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
      $("settings").close();
  });

  $("startBtn").onclick = startPractice;
  $("evalYes").onclick = evalYes;
  $("evalNo").onclick = evalNo;
  $("quizBtn").onclick = startQuiz;
  $("listenBtn").onclick = listen;

  $("camToggle").onclick = () => camOn ? camStop() : camStart();

  $("soundToggle").onclick = () => {
    data.sound = !data.sound;
    save();
    syncSound();
    sfx("tap");                      /* prueba de sonido al activarlo */
  };

  $("openSettings").onclick = () => {
    $("optLandmarks").checked = data.landmarks;
    $("settings").showModal();
  };

  $("closeSettings").onclick = () => $("settings").close();

  $("optLandmarks").onchange = event => {
    data.landmarks = event.target.checked;
    save();

    if (data.landmarks && camOn) {
      $("handState").textContent = "Detector de manos: cargando…";
      startLM();
    } else if (data.landmarks) {
      toast("El detector se activará al encender la cámara.");
    } else {
      cancelAnimationFrame(det);
      hand = false;
      const canvas = $("overlay");
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      $("handState").textContent = "Detector de manos: apagado";
    }
  };

  $("clearProgress").onclick = () => {
    if (!confirm("¿Seguro que quieres borrar todo tu progreso guardado en este navegador? Esta acción no se puede deshacer.")) return;

    const sound = data.sound;
    const landmarks = data.landmarks;

    data = { ...DEF, v2: 1, v3: 1, sound, landmarks, overlay: data.overlay, hold: data.hold, tol: data.tol, autoNext: data.autoNext, vol: data.vol };
    save();
    score = 0;
    reset();
    lv = 1;
    idx = 0;
    endQuiz();
    $("settings").close();
    renderLevels();
    render();
    renderStats();
    toast("Progreso borrado");
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && camOn) keepAwake(true);
    if (document.hidden) held = 0;
    if (document.hidden && (phase === "run" || phase === "eval")) {
      reset();
      fb("Práctica pausada porque saliste de la pestaña.", "warn");
      render();
    }
  });

  window.addEventListener("pagehide", () => {
    stopClock();
    camStop();
  });
}


/* 19. INICIALIZACIÓN */
function init() {
  validateData();

  data = load();
  save();                            /* guarda la migración de progreso (v3) una sola vez */
  syncSound();
  bindEvents();
  dockRef();
  renderLevels();
  renderGuide();

  let nextLevel = 1;

  for (let number = LEVELS.length; number >= 1; number--) {
    if (unlocked(number) && !passed(number)) {
      nextLevel = number;
      break;
    }
  }

  selectLevel(nextLevel);
  renderStats();
}


/* =========================================================
   20. MOTOR DE DETECCIÓN (geometría 3D local con landmarks)
========================================================= */

/* ==DETECTOR-START== */
/*
  Detector geométrico 3D (sin entrenamiento, sin posiciones absolutas).
  - Usa las coordenadas "world" de MediaPipe: los ángulos y distancias no
    dependen de la distancia a la cámara ni del tamaño de la mano (todo se
    normaliza con el largo de la palma).
  - Curl de cada dedo = mezcla de flexión de articulaciones y alcance de la
    punta respecto a la muñeca (más estable que una sola medida).
  - Pulgar: posición lateral + extensión + alcance (distingue A de S/T y el
    pulgar "hacia adelante" de P/K).
  - Orientación: ángulo en la imagen del eje muñeca→nudillos; si la mano apunta
    a la cámara el ángulo no es fiable y su peso baja solo.
  - Se calcula el costo de TODAS las letras: la pedida solo se acepta si encaja
    y ninguna otra (fuera de su grupo EQUIV) encaja claramente mejor.
*/
const GCDetector = (() => {
  const RAD = 180 / Math.PI;
  const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  const REACH_FULL = [1.95, 2.05, 2.0, 1.8];       /* |muñeca→punta| / |muñeca→nudillo| con el dedo recto */
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
  const len = v => Math.hypot(v.x, v.y, v.z);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const dist3 = (a, b) => len(sub(a, b));
  const avg = pts => ({
    x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
    y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
    z: pts.reduce((s, q) => s + (q.z || 0), 0) / pts.length
  });
  const angleBetween = (u, v) =>
    Math.acos(clamp(dot(u, v) / ((len(u) * len(v)) || 1e-9), -1, 1)) * RAD;

  /* Bandas aceptadas de curl: 1 = extendido, 0 = doblado, 2 = a medias */
  const BANDS = { 1: [0, 0.34], 0: [0.62, 1], 2: [0.2, 0.9] };
  const W_FINGER = 1, W_THUMB = 0.7, W_ORI = 0.8, W_SPREAD = 0.8;
  const NAMES = ["índice", "medio", "anular", "meñique"];

  function features(p, w, aspect) {
    const P = dist3(w[0], w[9]) || 1e-6;                 /* largo de la palma (m) */

    /* Curl por dedo (0 = recto, 1 = cerrado) */
    const curl = FINGERS.map(([m, a, b, t], i) => {
      const meta = sub(w[m], w[0]);
      const s1 = sub(w[a], w[m]), s2 = sub(w[b], w[a]), s3 = sub(w[t], w[b]);
      const byAngle = clamp((angleBetween(meta, s1) + angleBetween(s1, s2) + angleBetween(s2, s3)) / 220);
      const reach = dist3(w[0], w[t]) / (dist3(w[0], w[m]) || 1e-6);
      const byReach = clamp((REACH_FULL[i] - reach) / (REACH_FULL[i] - 1));
      return 0.65 * byAngle + 0.35 * byReach;
    });
    const cls = curl.map(c => c < 0.26 ? 1 : c > 0.72 ? 0 : 2);

    const mcp = avg([w[5], w[9], w[13], w[17]]);
    const centre = avg([w[0], mcp]);

    /* Pulgar */
    const axV = sub(w[17], w[5]);
    const axL = len(axV) || 1e-9;
    const ax = { x: axV.x / axL, y: axV.y / axL, z: axV.z / axL };
    const tv = sub(w[4], w[5]);
    const tx = dot(tv, ax) / P;                           /* negativo = pulgar por fuera de la palma */
    const tOut = len(tv) / P;
    const sepA = clamp(0.7 * clamp(-tx / 0.25) + 0.3 * clamp((tOut - 0.55) / 0.35));
    const flex = angleBetween(sub(w[2], w[1]), sub(w[3], w[2])) + angleBetween(sub(w[3], w[2]), sub(w[4], w[3]));
    const ext = clamp(1 - (flex - 25) / 70);              /* 1 = pulgar recto */
    const reachT = dist3(w[4], centre) / P;
    const sepB = ext * clamp((reachT - 0.45) / 0.25);      /* pulgar recto y alejado de la palma */
    const sep = Math.max(sepA, sepB);
    const pinch = dist3(w[4], w[8]) / P;                  /* pulgar tocando la punta del índice */

    /* Orientación en la imagen (corrigiendo la proporción) */
    const mi = avg([p[5], p[9], p[13], p[17]]);
    const dx = (mi.x - p[0].x) * aspect, dy = mi.y - p[0].y;
    const ang = Math.atan2(-dy, dx) * RAD;                /* 90 = arriba, -90 = abajo */
    const palmImg = Math.hypot((p[9].x - p[0].x) * aspect, p[9].y - p[0].y);
    const va = sub(mcp, w[0]);
    const inPlane = Math.hypot(va.x, va.y) / (len(va) || 1e-9);   /* 1 = la mano está de frente al plano de la imagen */

    /* Separación índice–medio: ángulo y distancia entre puntas */
    const angSp = angleBetween(sub(w[8], w[5]), sub(w[12], w[9]));
    const gap = dist3(w[8], w[12]) / P;
    const spread = Math.max(angSp, (gap - 0.3) * 60);

    return { P, curl, cls, tx, tOut, sep, pinch, ang, palmImg, inPlane, spread,
             thumb: pinch < 0.35 && curl[0] > 0.08 ? 2 : sep >= 0.4 ? 1 : 0,
             ori: ang > 45 && ang < 135 ? "up" : ang < -45 && ang > -135 ? "down" : "side" };
  }

  const fingerCost = (c, code) => {
    const [lo, hi] = BANDS[code] || BANDS[2];
    return clamp((c < lo ? lo - c : c > hi ? c - hi : 0) / 0.35);
  };

  const thumbCost = (f, code) => code === 1 ? clamp((0.35 - f.sep) / 0.3)
    : code === 0 ? clamp((f.sep - 0.5) / 0.4)
    : clamp((f.pinch - 0.3) / 0.35);

  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const oriErr = (ang, o) => o === "up" ? angDiff(ang, 90)
    : o === "down" ? angDiff(ang, -90)
    : Math.min(angDiff(ang, 0), angDiff(ang, 180));
  /* Zona libre de 40° y costo completo a 80°; si la mano apunta a la cámara pesa menos */
  const oriCost = (f, o) => clamp((oriErr(f.ang, o) - 40) / 40) * clamp((f.inPlane - 0.35) / 0.35);

  const spreadCost = (deg, sp) => sp === "apart" ? clamp((18 - deg) / 12) : clamp((deg - 14) / 12);

  function cost(rule, f) {
    let c = 0;
    rule.f.forEach((v, i) => {
      if (v === -1) return;
      c += W_FINGER * Math.min(...[].concat(v).map(code => fingerCost(f.curl[i], code)));
    });
    const th = [].concat(rule.th ?? -1);
    if (!th.includes(-1)) c += W_THUMB * Math.min(...th.map(code => thumbCost(f, code)));
    const o = [].concat(rule.o || "any");
    if (!o.includes("any")) c += W_ORI * Math.min(...o.map(x => oriCost(f, x)));
    if (rule.sp) c += W_SPREAD * spreadCost(f.spread, rule.sp);
    return c;
  }

  const groupOf = letter => {
    const groups = typeof EQUIV !== "undefined" ? EQUIV : [];
    return groups.find(g => g.includes(letter)) || [letter];
  };

  /* tol: 0 = estricta, 0.5 = normal, 1 = flexible (mismo ajuste de la pantalla de ajustes) */
  function classify(f, shapes, tol, target) {
    const t = clamp(Number.isFinite(tol) ? tol : 0.5);
    const thr = 0.45 + 0.65 * t;
    const margin = 0.05 + 0.35 * t;
    const costs = {};
    let bestCost = Infinity;

    for (const letter in shapes) {
      const c = cost(shapes[letter], f);
      costs[letter] = c;
      if (c < bestCost) bestCost = c;
    }
    const list = Object.keys(costs).filter(k => costs[k] <= bestCost + 0.04).slice(0, 3);

    let ok = false, mine = null;
    if (target && costs[target] !== undefined) {
      mine = costs[target];
      const rule = shapes[target];
      const same = groupOf(target);
      let other = Infinity;
      for (const k in costs) if (!same.includes(k) && costs[k] < other) other = costs[k];
      const moving = !!rule.mv;               /* en las letras con movimiento la forma varía más */
      const k = rule.k || 1;
      ok = mine <= thr * k * (moving ? 1.2 : 1) && (moving || mine <= other + margin * k);
    }
    return { ok, list, bestCost, cost: mine, thr };
  }

  /* Suavizado exponencial; se reinicia si la mano desaparece un instante */
  function createSmoother(alpha = 0.55, gapMs = 250) {
    let sp = null, sw = null, seen = 0;
    const copy = q => ({ x: q.x, y: q.y, z: q.z || 0 });
    const blend = (prev, cur) => cur.map((q, i) => {
      const o = prev[i];
      return { x: o.x + (q.x - o.x) * alpha, y: o.y + (q.y - o.y) * alpha, z: o.z + ((q.z || 0) - o.z) * alpha };
    });
    return {
      push(p, w, aspect, now) {
        /* Si no hay coordenadas 3D reales se aproximan con las de la imagen */
        const ww = w || p.map(q => ({ x: q.x * aspect, y: q.y, z: (q.z || 0) * aspect }));
        if (!sp || now - seen > gapMs) { sp = p.map(copy); sw = ww.map(copy); }
        else { sp = blend(sp, p); sw = blend(sw, ww); }
        seen = now;
        return { p: sp, w: sw };
      },
      reset() { sp = sw = null; seen = 0; }
    };
  }

  /* Consejo concreto para el usuario: lo que más se aleja de la regla de la letra */
  function advise(rule, f) {
    let worst = 0.3, msg = "";
    const take = (c, m) => { if (c > worst) { worst = c; msg = m; } };

    rule.f.forEach((v, i) => {
      if (v === -1) return;
      let best = Infinity, code = [].concat(v)[0];
      [].concat(v).forEach(cd => { const c = fingerCost(f.curl[i], cd); if (c < best) { best = c; code = cd; } });
      take(best, code === 1 ? `Estira más el dedo ${NAMES[i]}.`
        : code === 0 ? `Dobla más el dedo ${NAMES[i]}.`
        : f.curl[i] < 0.2 ? `Dobla un poco el dedo ${NAMES[i]}.` : `Estira un poco el dedo ${NAMES[i]}.`);
    });

    const th = [].concat(rule.th ?? -1);
    if (!th.includes(-1)) {
      let best = Infinity, code = th[0];
      th.forEach(cd => { const c = thumbCost(f, cd); if (c < best) { best = c; code = cd; } });
      take(W_THUMB * best, code === 1 ? "Separa un poco el pulgar de la mano."
        : code === 0 ? "Pega el pulgar a la mano."
        : "Une la punta del pulgar con la del índice.");
    }
    if (rule.sp) take(W_SPREAD * spreadCost(f.spread, rule.sp),
      rule.sp === "apart" ? "Intenta separar un poco los dedos índice y medio." : "Junta los dedos índice y medio.");

    const o = [].concat(rule.o || "any");
    if (!o.includes("any")) {
      const c = W_ORI * Math.min(...o.map(x => oriCost(f, x)));
      const first = o[0];
      take(c, first === "up" ? "Levanta la mano: los dedos deben apuntar hacia arriba."
        : first === "down" ? "Voltea la mano: los dedos deben apuntar hacia abajo."
        : "Gira la mano hacia un lado, como en la referencia.");
    }
    return msg || "Compara tu mano con la referencia y mantenla quieta.";
  }

  function describe(f) {
    const n = ["Índ", "Med", "Anu", "Meñ"], sym = ["↓", "↑", "~"];
    return f.cls.map((v, i) => n[i] + sym[v] + Math.round(f.curl[i] * 100)).join(" ") +
      ` · pulgar ${["pegado", "fuera", "pinza"][f.thumb]} (${Math.round(f.sep * 100)}) · ${f.ori} · sep ${Math.round(f.spread)}°`;
  }

  return { features, classify, createSmoother, describe, advise };
})();
/* ==DETECTOR-END== */

let needBreak = false, auto = false, stuck = false, held = 0, cool = 0, since = 0;
let trail = [], queue = [], qi = 0, nextT = null;
let lastTick = 0, movedUntil = 0, coachMsg = "", coachAt = 0, lostAt = 0;
const votes = [];
const smoother = GCDetector.createSmoother();
const playable = l => l.items.some(i => (l.type === "words" ? spell(i) : [i]).some(hasRef));
let hbarV = -1;
const hbar = p => {
  const v = Math.round(p * 50);
  if (v === hbarV) return;                 /* solo si el avance cambió de verdad */
  hbarV = v;
  const e = $("holdBar");
  if (e) e.style.transform = `scaleX(${v / 50})`;
};

function reset() {
  resetBase();
  auto = false; stuck = false; held = 0; trail = []; movedUntil = 0; coachMsg = ""; coachAt = 0; lostAt = 0; votes.length = 0;
  clearTimeout(nextT); hbar(0);
}

function render() {
  renderBase();
  const l = L(lv);
  $("startBtn").hidden = ["run", "eval", "auto"].includes(phase);
  setText("startBtn", "Práctica manual");
  $("evalBox").hidden = !(phase === "eval" || (phase === "auto" && stuck));
  setText("autoBtn", auto ? "■ Detener nivel" : "▶ Iniciar nivel");
  $("autoBtn").classList.toggle("stop", auto);
  $("restartBtn").disabled = phase === "run";
  $("autoBtn").disabled = l.type === "phrases" || !playable(l);
  $("camStart").disabled = $("autoBtn").disabled;
  if (phase === "auto") setText("timer", "");
  updateCamState();
}

/* Texto de instrucción actual (qué debe hacer la persona) */
function promptFor() {
  const level = L(lv), item = cur();
  if (!level || !item) return "";
  if (level.type === "words") {
    const sp = steps(), n = Math.min(step, sp.length - 1);
    return `Deletrea ${item}: haz la letra ${sp[n]} (${n + 1} de ${sp.length}).`;
  }
  return `Haz la letra ${item} y mantén la posición.`;
}

/* Mensajes de ayuda: solo cuando cambian, con una pausa mínima entre mensajes
   y tras unos segundos sin éxito (no se corrige antes de tiempo). */
const HOLD_MSG = "Mantén la posición…";
function setCoach(msg, now, urgent) {
  if (msg === coachMsg) return;
  if (!urgent && msg && now - since < 2500) return;
  if (!urgent && msg && coachMsg && now - coachAt < 1500) return;
  coachMsg = msg;
  coachAt = now;
  fb(msg || promptFor(), !msg ? "" : msg === HOLD_MSG ? "ok" : "warn");
}

function coachFor(f, p) {
  if (f.palmImg < 0.1) return "Acerca un poco más tu mano a la cámara.";
  if (p.some(q => q.x < 0.01 || q.x > 0.99 || q.y < 0.01 || q.y > 0.99))
    return "Aleja un poco tu mano: se sale del cuadro.";
  return "";
}

/* Movimiento: extensión del recorrido de la punta en la última 1.5 s (resistente al temblor) */
function updateMotion(point, now, palm) {
  trail.push({ x: point.x, y: point.y, t: now });
  while (trail.length && now - trail[0].t > 1500) trail.shift();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of trail) {
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
  }
  if (Math.max(x1 - x0, y1 - y0) > 0.5 * palm) movedUntil = now + 700;
}

function autoTick(sm, now, aspect) {
  if (now < cool) { lastTick = 0; return; }

  const letter = steps()[step], rule = SHAPES[letter];

  if (!rule) {
    if (!stuck) { stuck = true; fb(`«${letter}» no tiene reglas automáticas. Hazla como en la referencia y pulsa «Lo conseguí».`, "warn"); render(); }
    return;
  }

  const dt = lastTick ? Math.min(120, now - lastTick) : 0;
  lastTick = now;
  const need = rule.mv ? 300 : (data.hold || HOLD_MS);

  if (!sm) {
    held = Math.max(0, held - dt * 2);
    trail = [];
    votes.length = 0;
    hbar(held / need);
    setText("handState", "Sin mano a la vista");
    if (!lostAt) lostAt = now;
    /* el aviso solo aparece si la mano falta más de 0,7 s (evita parpadeos) */
    if (now - lostAt > 700) setCoach("Coloca tu mano frente a la cámara, dentro del cuadro y con buena luz.", now, true);
    return;
  }
  lostAt = 0;

  const f = GCDetector.features(sm.p, sm.w, aspect);
  const res = GCDetector.classify(f, SHAPES, data.tol ?? TOL, letter);

  if (needBreak) { votes.length = 0; if (res.ok) return; needBreak = false; }

  if (rule.mv) updateMotion({ x: sm.p[rule.mv].x * aspect, y: sm.p[rule.mv].y }, now, f.palmImg);
  const moved = !rule.mv || now < movedUntil;

  /* Texto de estado: qué letra cree ver la app */
  const seen = res.bestCost <= res.thr + 0.3 ? "Detecto: " + res.list.join(" / ") : "Forma no reconocida";
  setText("handState", DEBUG ? `${seen} · ${GCDetector.describe(f)}` : seen);

  /* Confirmación: la forma debe cumplirse en 5 de los últimos 8 fotogramas (tolera
     un parpadeo, pero no una coincidencia momentánea) y además mantenerse el tiempo
     de sostén. Si se pierde, el avance decae al doble de rápido (tolera temblor). */
  votes.push(res.ok && moved);
  if (votes.length > 8) votes.shift();
  const match = votes.reduce((n, v) => n + v, 0) >= 5;
  held = match ? held + dt : Math.max(0, held - dt * 2);
  const pr = Math.min(1, held / need);
  hbar(pr);

  if (pr >= 1) { autoOk(); return; }

  if (match && pr > 0.12) { setCoach(HOLD_MSG, now, true); return; }
  if (res.ok && rule.mv && !moved) { setCoach("Muy bien: ahora haz el movimiento de la letra.", now); return; }

  let msg = coachFor(f, sm.p);
  if (!msg && res.bestCost > res.thr * 0.6) msg = GCDetector.advise(rule, f);
  setCoach(msg, now);

  if (now - since > 20000 && !stuck) {
    stuck = true;
    fb("No te preocupes, inténtalo nuevamente con buena luz. Si tu seña ya coincide con la referencia, pulsa «Lo conseguí».", "warn");
    render();
  }
}

function autoOk() {
  held = 0; trail = []; movedUntil = 0; coachMsg = ""; lastTick = 0; votes.length = 0; hbar(0);
  cool = performance.now() + 1200; since = cool; stuck = false;
  const sp = steps();
  if (L(lv).type === "words" && step < sp.length - 1) {
    needBreak = sp[step + 1] === sp[step];
    celebrate("step", sp[step]);
    sfx("step");
    step++;
    fb(`¡Bien! Ahora la letra ${sp[step]}.`, "ok");
    render();
    return;
  }
  step = 0;
  complete();
}

function complete() {
  const was = auto, wasPassed = passed(lv), n = lv;
  completeBase();
  if (was) { auto = true; phase = "auto"; advanceAuto(); }
  else if (!wasPassed && passed(n)) levelUp(n, lvGain);
  enterAnim();
}

function advanceAuto() {
  const l = L(lv); qi++;
  if (qi < queue.length) {
    idx = l.items.indexOf(queue[qi]); step = 0; stuck = false; since = performance.now() + 1200;
    fb(`¡Correcto! Pasemos a la siguiente ${l.type === "words" ? "palabra" : "letra"}: ${queue[qi]}.`, "ok");
    render();
    return;
  }
  auto = false; phase = "idle"; hbar(0);
  let bonus = 0;
  if (!passed(lv)) {
    data.levels.push(lv); data.points += 50; score += 50; bonus = 50;
    data.history.unshift({ t: Date.now(), w: `Nivel ${lv} superado`, p: 50 });
    checkBadges(); save();
  }
  fb(`¡Nivel ${lv} superado!`, "ok");
  renderLevels(); render(); renderStats();
  levelUp(lv, lvGain + bonus);
}

function evalYes() {
  if (auto) { autoOk(); return; }
  evalYesBase();
}
function evalNo() {
  if (auto) { stuck = false; since = performance.now(); fb("Sigue intentando.", ""); render(); return; }
  evalNoBase();
}

function stopAuto() {
  auto = false; phase = "idle"; stuck = false; held = 0; hbar(0); clearTimeout(nextT);
  fb("Nivel detenido. Pulsa «Iniciar nivel» para continuar."); render();
}

async function startLevel() {
  if (auto) { stopAuto(); return; }
  const l = L(lv);
  if (l.type === "phrases") { fb("Las frases aún no tienen detección automática ni referencias validadas.", "warn"); return; }
  if (!camOn) { await camStart(); if (!camOn) return; }
  data.landmarks = true; $("optLandmarks").checked = true; save();
  if (!lm) fb("Preparando el detector de manos… la primera vez puede tardar unos segundos.");
  await startLM();
  if (!lm) { fb("No se pudo cargar el detector (¿sin internet?). Usa «Práctica manual».", "warn"); return; }
  reset();
  queue = l.items.filter(i => !isDone(l, i)); if (!queue.length) queue = [...l.items];
  qi = 0; idx = l.items.indexOf(queue[0]);
  auto = true; phase = "auto"; since = performance.now() + 800; cool = since; lastTick = 0;
  if (narrow()) $("camBox").scrollIntoView({ behavior: "smooth", block: "center" });
  fb(promptFor()); render();
}

function camStop() {
  if (auto) { auto = false; phase = "idle"; fb("Cámara apagada: nivel en pausa.", "warn"); }
  camStopBase(); hbar(0); smoother.reset(); held = 0;
}

let lmP = null;
function startLM() { return lm ? startLMBase() : (lmP = lmP || startLMBase().finally(() => { lmP = null; })); }
$("autoBtn").onclick = startLevel;
$("optLandmarks").addEventListener("change", e => { if (!e.target.checked && auto) stopAuto(); });


/* ===== REINICIAR NIVEL Y AJUSTES ===== */
function restartLevel() {
  const l = L(lv);
  if (!confirm(`¿Reiniciar el nivel ${lv}? Se borrará tu avance en este nivel. Tus puntos, historial e insignias se conservan.`)) return;
  const arr = list(l);
  l.items.forEach(i => { const k = arr.indexOf(i); if (k >= 0) arr.splice(k, 1); delete data.mastery[i]; });
  data.levels = data.levels.filter(n => n !== lv);
  save(); endQuiz(); reset(); idx = 0; step = 0;
  renderLevels(); render(); renderStats();
  fb(`Nivel ${lv} reiniciado. Pulsa «Iniciar nivel» para comenzar.`); toast("Nivel reiniciado");
}
function syncSettings() {
  $("optLandmarks").checked = !!data.landmarks;
  $("optOverlay").checked = data.overlay !== false;
  $("optAutoNext").checked = data.autoNext !== false;
  $("optHold").value = String(data.hold || HOLD_MS);
  $("optTol").value = String(data.tol ?? TOL);
  $("optVol").value = String(data.vol ?? 0.9);
  $("soundToggle").checked = !!data.sound;
}
$("restartBtn").onclick = restartLevel;
$("openSettings").addEventListener("click", syncSettings);
$("optOverlay").onchange = e => { data.overlay = e.target.checked; save(); if (!data.overlay) { const c = $("overlay"); c.getContext("2d").clearRect(0, 0, c.width, c.height); drawn = false; } };
$("optAutoNext").onchange = e => { data.autoNext = e.target.checked; save(); };
$("optHold").onchange = e => { data.hold = Number(e.target.value); save(); toast("Tiempo de sostén actualizado"); };
$("optTol").onchange = e => { data.tol = Number(e.target.value); save(); toast("Exigencia actualizada"); };
$("optVol").onchange = e => { data.vol = Number(e.target.value); save(); sfx("letter"); };
$("resetSettings").onclick = () => {
  data.overlay = true; data.autoNext = true; data.hold = HOLD_MS; data.tol = TOL; data.sound = true; data.vol = 0.9; save(); syncSettings(); toast("Ajustes restablecidos");
};

/* ===== SONIDO =====
   Un solo AudioContext con compresor (más volumen sin distorsión). Se crea/activa
   en el primer toque del usuario, requisito de los navegadores móviles. */
let master = null, audioReady = false;
const SFX = {
  tap:    { n: [[880, 0]], d: 0.06, p: 0.14, v: 8 },
  step:   { n: [[784, 0]], d: 0.14, p: 0.26, v: 15 },
  letter: { n: [[784, 0], [1175, 0.09]], d: 0.2, p: 0.34, v: [20, 30, 25] },
  word:   { n: [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.25]], d: 0.24, p: 0.34, v: [25, 40, 25, 40] },
  level:  { n: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3], [1319, 0.42], [1568, 0.54]], d: 0.4, p: 0.34, v: [40, 60, 40, 60, 120] },
  warn:   { n: [[392, 0], [294, 0.12]], d: 0.2, p: 0.24, v: 40 }
};

function audio() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 6;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(actx.destination);
    }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    if (!audioReady) {                                    /* sonido mudo: "desbloquea" iOS */
      const src = actx.createBufferSource();
      src.buffer = actx.createBuffer(1, 1, 22050);
      src.connect(actx.destination);
      src.start(0);
      audioReady = true;
    }
    master.gain.value = Math.max(0.2, Math.min(2, Number(data?.vol) || 0.9));
    return actx;
  } catch (error) {
    console.warn("Sonido no disponible:", error);
    return null;
  }
}

function sfx(kind) {
  if (!data?.sound) return;
  const s = SFX[kind];
  if (!s) return;
  navigator.vibrate?.(s.v);
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.01;
  s.n.forEach(([freq, off], i) => {
    const t = t0 + off;
    const dur = i === s.n.length - 1 ? s.d * 1.6 : s.d;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(s.p, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    [[freq, "sine", 1], [freq * 2, "triangle", 0.22]].forEach(([f, type, amp]) => {
      const osc = ctx.createOscillator(), og = ctx.createGain();
      osc.type = type; osc.frequency.value = f; og.gain.value = amp;
      osc.connect(og); og.connect(g);
      osc.start(t); osc.stop(t + dur + 0.02);
    });
  });
}

const unlockAudio = () => { if (data?.sound) audio(); };
["pointerdown", "touchend", "click", "keydown"].forEach(ev => addEventListener(ev, unlockAudio, { passive: true }));

/* Sonido breve en los botones principales (no se repite mientras la cámara busca) */
document.addEventListener("click", event => {
  if (event.target.closest("#lfGo, #lfStay")) return;
  if (event.target.closest(".primary-btn, .success-btn, .level-btn")) sfx("tap");
});


/* ===== ANIMACIONES =====
   Solo transform/opacity, breves, y sin interceptar toques (pointer-events:none):
   no interfieren con la detección. Con «movimiento reducido» se omiten las partículas. */
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HUES = [199, 217, 262, 292, 330, 48];

function fxAdd(html, cls, ms) {
  const layer = $("camFx");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = html;
  layer.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function burst(count, radius) {
  const layer = $("camFx");
  if (!layer || reduced()) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const el = document.createElement("i");
    el.className = "fx-p";
    el.style.setProperty("--a", (i * 360 / count + Math.random() * 14) + "deg");
    el.style.setProperty("--d", (radius * (0.6 + Math.random() * 0.6)) + "px");
    el.style.setProperty("--h", HUES[i % HUES.length]);
    frag.appendChild(el);
  }
  layer.appendChild(frag);
  setTimeout(() => layer.querySelectorAll(".fx-p").forEach(e => e.remove()), 900);
}

function pulse(el, keyframes, ms) {
  if (el && !reduced() && el.animate) el.animate(keyframes, { duration: ms, easing: "ease-out" });
}

/* kind: "step" (letra dentro de una palabra) | "letter" | "word" (palabra o frase) */
function celebrate(kind, text, pts = 0, progress = "") {
  fxAdd("", "fx-ring", 700);
  if (kind === "step") {
    fxAdd(`<span>${esc(text)} ✓</span>`, "fx-pop mini show", 900);
    burst(6, 50);
    return;
  }
  if (kind === "letter") {
    fxAdd(`<span>${esc(text)} ✓</span><small>${esc(progress)} · +${pts}</small>`, "fx-pop show", 1000);
    burst(12, 90);
  } else {
    const label = L(lv)?.type === "phrases" ? "Frase completa" : "Palabra completa";
    fxAdd(`<span>¡${label}!</span><small>${esc(text)} · +${pts} puntos</small>`, "fx-pop wide show", 1300);
    burst(20, 120);
  }
  pulse(document.querySelector(".target-card"),
    [{ boxShadow: "0 0 0 0 rgba(125,211,252,0)" }, { boxShadow: "0 0 0 8px rgba(125,211,252,.45)" }, { boxShadow: "0 0 0 0 rgba(125,211,252,0)" }], 650);
  pulse($("levelBar"), [{ filter: "brightness(1)" }, { filter: "brightness(1.9)" }, { filter: "brightness(1)" }], 600);
}

/* Aparición de lo nuevo (siguiente letra/palabra y su referencia) */
function enterAnim() {
  const from = [{ opacity: 0, transform: "translateY(10px) scale(.92)" }, { opacity: 1, transform: "none" }];
  [$("target"), $("camLetter"), $("refBox")].forEach(el => {
    if (el && !reduced() && el.animate) el.animate(from, { duration: 340, easing: "cubic-bezier(.2,.9,.3,1.2)" });
  });
}


/* ===== NIVEL COMPLETADO ===== */
let lfTimer = null;

function levelUp(n, gained) {
  const level = L(n), next = L(n + 1);
  if (!level || !$("levelFx")) return;

  setText("lfName", `Nivel ${n} · ${level.name}`);
  setText("lfPts", "+" + Math.max(0, gained));
  setText("lfNext", next
    ? `Nivel ${n + 1} desbloqueado: ${next.name}`
    : "¡Completaste los 15 niveles! Eres Gesture Master.");
  $("lfGo").hidden = !next;
  setText("lfStay", next ? "Quedarme aquí" : "Cerrar");

  const conf = $("lfConf");
  conf.innerHTML = reduced() ? "" : Array.from({ length: 26 }, (_, i) =>
    `<i style="--x:${(i * 37) % 100}%;--dl:${(i % 9) * 0.12}s;--h:${HUES[i % HUES.length]};--r:${(i * 53) % 360}deg"></i>`).join("");

  clearTimeout(lfTimer);
  const timer = $("lfTimer");
  timer.innerHTML = "";
  if (next && data.autoNext !== false) {
    timer.innerHTML = '<i></i>';
    lfTimer = setTimeout(() => closeLevelFx(true), 6000);
  }

  sfx("level");
  $("levelFx").hidden = false;
  (next ? $("lfGo") : $("lfStay")).focus({ preventScroll: true });
}

function closeLevelFx(goNext) {
  clearTimeout(lfTimer);
  if ($("levelFx").hidden) return;
  $("levelFx").hidden = true;
  if (goNext && L(lv + 1) && unlocked(lv + 1)) selectLevel(lv + 1);
}

$("lfGo").onclick = () => closeLevelFx(true);
$("lfStay").onclick = () => closeLevelFx(false);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("levelFx").hidden) closeLevelFx(false);
});


/* ===== REFERENCIA DENTRO DE LA CÁMARA (móvil) =====
   El mismo nodo #refBox se mueve entre el panel (escritorio) y la tarjeta flotante
   de la cámara (móvil): no hay elementos duplicados ni una segunda cámara. */
const dockMQ = window.matchMedia("(max-width:900px)");
function dockRef() {
  const box = $("refBox"), panel = $("refPanel"), card = $("refFloat");
  if (!box || !panel || !card) return;
  const dock = dockMQ.matches;
  if (dock && box.parentElement !== card) card.appendChild(box);
  else if (!dock && box.parentElement !== panel) panel.appendChild(box);
  panel.classList.toggle("docked", dock);
  if (!dock) card.classList.remove("big");
}
dockMQ.addEventListener ? dockMQ.addEventListener("change", dockRef) : dockMQ.addListener(dockRef);

const toggleRef = () => $("refFloat").classList.toggle("big");
$("refFloat").addEventListener("click", toggleRef);
$("refFloat").addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleRef(); }
});

$("camStart").onclick = startLevel;

/* ===== ESTADO VISUAL DE LA CÁMARA =====
   Se actualiza cuando algo cambia (render, bucle de detección, cámara),
   ya no con un temporizador que corre todo el tiempo. */
function updateCamState() {
  const state = !camOn ? "off" : !hand ? "idle" : (auto && held > 0 ? "hold" : "hand");
  const label = { off: "Cámara apagada", idle: auto ? "Buscando tu mano…" : "Cámara lista", hand: "Mano detectada", hold: "¡Mantén así!" }[state];
  const l = L(lv), it = cur(), sp = steps();
  const letter = l && it && l.type !== "phrases" ? sp[Math.min(step, sp.length - 1)] : "";
  const key = state + label + letter + camOn;
  if (updateCamState.key === key) return;
  updateCamState.key = key;
  $("camBox").dataset.state = state;
  document.body.dataset.cam = camOn ? "on" : "off";
  setText("camBadge", label);
  setText("camLetter", camOn ? letter : "");
}

init();
