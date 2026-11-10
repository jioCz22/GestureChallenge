"use strict";

/* =========================================================
   GESTURECHALLENGE — MOTOR PRINCIPAL
========================================================= */

/* 1. CONFIGURACIÓN */
const $ = id => document.getElementById(id);
const STORE = "gesturechallenge_lsm_progress_v1";

const DEF = {
  done: [], best: 0, points: 0, levels: [],
  mastery: {}, words: [], phrases: [],
  streak: 0, lastDay: "", history: [],
  badges: [], sound: true, landmarks: false, v2: 0
};

let data, lv = 1, idx = 0, step = 0;
let full = false, phase = "idle", left = 0;
let clock = null, score = 0, quiz = null, qTimer = null;
let stream = null, camOn = false;
let lm = null, MP = null, du = null;
let det = 0, lastT = 0, hand = false, actx = null;
let detErr = 0, useCPU = false, lastVT = -1, drawn = false, wake = null;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";


/* 2. VALIDACIÓN DE DATA.JS */
function validateData() {
  const required = ["LEVELS", "STAGES", "STAGE_LV", "RES", "ALL", "BADGES"];
  const missing = required.filter(name => typeof window[name] !== "undefined" ? false : (() => {
    try { return eval(`typeof ${name} === "undefined"`); }
    catch { return true; }
  })());

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

  if (!Array.isArray(ALL) || ALL.length !== 27)
    throw new Error("ALL debe contener 27 letras.");

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

  console.info("Data.js validado correctamente.");
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

function beep(frequency = 650) {
  if (!data.sound) return;
  navigator.vibrate?.(frequency >= 800 ? 40 : 15);
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.frequency.value = frequency;
    gain.gain.value = 0.045;
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start();
    osc.stop(actx.currentTime + 0.12);
  } catch (error) {
    console.warn("Sonido no disponible:", error);
  }
}

function fb(message, color = "") {
  const el = $("feedback");
  if (!el) return;
  if (el.textContent !== message) el.textContent = message;
  const cls = "feedback " + color;
  if (el.className !== cls) el.className = cls;
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
        loading="lazy"
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
  setText("sbLetters", data.done.length + "/27"); setText("sbLevels", data.levels.length + "/15");
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

  const level = L(number);
  idx = level.items.findIndex(item => !isDone(level, item));
  if (idx < 0) idx = 0;

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
        beep(500);
        fb("Siguiente letra.");
      } else {
        stopClock();
        phase = "eval";
        beep(700);
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
    beep(760);

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

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

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
  beep(880);

  fb(`✓ «${item}» completado. +${points} puntos.` +
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
      beep(correct ? 880 : 300);

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

  if (correct && !passed(lv)) {
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
    : `Acertaste ${result}. Necesitas ${required} para avanzar. Repasa e inténtalo de nuevo.`,
    correct ? "ok" : "warn");
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
        numHands: 1
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
    cancelAnimationFrame(det);
    det = requestAnimationFrame(loop);
  }
}

function loop() {
  if (!camOn || !lm || !data.landmarks) return;

  det = requestAnimationFrame(loop);

  const now = performance.now();
  const video = $("camera");
  const gap = auto ? 66 : 120;               /* ~15 fps en práctica, ~8 en reposo */

  if (document.hidden || now - lastT < gap || video.readyState < 2 || !video.videoWidth) return;
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

  hand = result.landmarks.length > 0;
  const points = hand ? result.landmarks[0] : null;
  window.GC_LAST_LANDMARKS = points;

  if (auto && phase === "auto") autoTick(points, now);

  if (drawn) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; }

  if (points && data.overlay !== false) {
    du = du || new MP.DrawingUtils(ctx);
    du.drawConnectors(points, MP.HandLandmarker.HAND_CONNECTIONS, { color: "#7dd3fc", lineWidth: 3 });
    du.drawLandmarks(points, { color: "#fff", radius: 3 });
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
  set("statLetters", data.done.length + "/27");
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
  if (section !== "learn" && ["run", "eval", "auto"].includes(phase)) {
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

    data = { ...DEF, v2: 1, sound, landmarks, overlay: data.overlay, hold: data.hold, tol: data.tol, autoNext: data.autoNext };
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
    if (document.hidden && (phase === "run" || phase === "eval")) {
      reset();
      fb("Práctica pausada porque saliste de la pestaña.", "warn");
      render();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopClock();
    camStop();
  });
}


/* 19. INICIALIZACIÓN */
function init() {
  validateData();

  data = load();
  syncSound();
  bindEvents();
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

  console.info("GestureChallenge iniciado correctamente.");
}

/* =========================================================
   20. MODO AUTÓNOMO (detección geométrica local con landmarks)
========================================================= */
let needBreak = false, auto = false, stuck = false, holdStart = 0, lastMatch = 0, cool = 0, since = 0, trail = [], queue = [], qi = 0, nextT = null;
const playable = l => l.items.some(i => (l.type === "words" ? spell(i) : [i]).some(hasRef));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let hbarV = -1;
const hbar = p => {
  const v = Math.round(p * 50);
  if (v === hbarV) return;                 /* solo si el avance cambió de verdad */
  hbarV = v;
  const e = $("holdBar");
  if (e) e.style.transform = `scaleX(${v / 50})`;
};

function reset() { resetBase(); auto = false; stuck = false; holdStart = 0; trail = []; clearTimeout(nextT); hbar(0); }

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
  if (phase === "auto") setText("timer", "");
  updateCamState();
}

function shapeOf(p) {
  const P = dist(p[0], p[9]) || 1e-6;
  const f = [[8, 5], [12, 9], [16, 13], [20, 17]].map(([t, m]) => {
    const r = dist(p[t], p[0]) / dist(p[m], p[0]);
    return r > 1.65 ? 1 : r < 1.3 ? 0 : 2;
  });
  const th = f[0] !== 0 && dist(p[4], p[8]) / P < .35 ? 2 : dist(p[4], p[5]) / P > .8 ? 1 : 0;
  const dx = p[9].x - p[0].x, dy = p[9].y - p[0].y;
  const o = Math.abs(dx) > Math.abs(dy) ? "side" : dy < 0 ? "up" : "down";
  const g = dist(p[8], p[12]) / P;
  return { f, th, o, sp: g > .5 ? "apart" : g < .35 ? "together" : "mid", P };
}

function matchShape(letter, s) {
  const t = SHAPES[letter]; let bad = 0;
  t.f.forEach((v, i) => { if (v >= 0 && s.f[i] !== v) bad += (s.f[i] === 2 || v === 2) ? .5 : 1; });
  if (t.th >= 0 && t.th !== s.th) bad += .5;
  if (t.o && t.o !== "any" && t.o !== s.o) bad += 1;
  if (t.sp && s.sp !== "mid" && t.sp !== s.sp) bad += 1;
  return bad <= (data.tol ?? TOL);
}

function movedEnough(letter, p, now, P) {
  const t = SHAPES[letter]; if (!t.mv) return true;
  trail.push({ x: p[t.mv].x, y: p[t.mv].y, t: now });
  while (trail.length && now - trail[0].t > 1500) trail.shift();
  let len = 0; for (let i = 1; i < trail.length; i++) len += dist(trail[i], trail[i - 1]);
  return len > .6 * P;
}

function describe(s) {
  const n = ["Índ", "Med", "Anu", "Meñ"], sym = ["↓", "↑", "~"];
  return "" + s.f.map((v, i) => n[i] + sym[v]).join(" ") + " · pulgar " + ["pegado", "fuera", "pinza"][s.th] + " · " + s.o;
}

function autoTick(p, now) {
  if (now < cool) return;
  const letter = steps()[step], t = SHAPES[letter];
  if (!t) {
    if (!stuck) { stuck = true; fb(`«${letter}» no tiene reglas automáticas (falta referencia). Hazla y pulsa «Lo conseguí».`, "warn"); render(); }
    return;
  }
  if (!p) { holdStart = 0; trail = []; hbar(0); return; }
  const s = shapeOf(p);
  if (needBreak) { if (matchShape(letter, s)) return; needBreak = false; }
  setText("handState", describe(s));
  const moved = movedEnough(letter, p, now, s.P);
  if (matchShape(letter, s) && moved) { lastMatch = now; holdStart = holdStart || now; }
  else if (now - lastMatch > 250) holdStart = 0;
  const need = t.mv ? 300 : (data.hold || HOLD_MS), pr = holdStart ? Math.min(1, (now - holdStart) / need) : 0;
  hbar(pr);
  if (pr >= 1) autoOk();
  else if (now - since > 20000 && !stuck) {
    stuck = true;
    fb("¿No te detecta? Mejora la luz y el ángulo. Si tu seña coincide con la referencia, pulsa «Lo conseguí» (autoevaluación).", "warn");
    render();
  }
}

function autoOk() {
  holdStart = 0; trail = []; hbar(0);
  cool = performance.now() + 1200; since = cool; stuck = false;
  const sp = steps();
  if (L(lv).type === "words" && step < sp.length - 1) { needBreak = sp[step + 1] === sp[step]; step++; beep(760); fb("¡Bien! Siguiente letra.", "ok"); render(); return; }
  step = 0; complete();
}

function complete() {
  const was = auto;
  completeBase();
  if (was) { auto = true; phase = "auto"; advanceAuto(); }
}

function advanceAuto() {
  const l = L(lv); qi++;
  if (qi < queue.length) {
    idx = l.items.indexOf(queue[qi]); step = 0; stuck = false; since = performance.now() + 1200;
    fb(`✓ ¡Bien! Ahora haz: ${queue[qi]}`, "ok"); render(); return;
  }
  auto = false; phase = "idle"; hbar(0);
  if (!passed(lv)) { data.levels.push(lv); data.points += 50; score += 50; data.history.unshift({ t: Date.now(), w: `Nivel ${lv} superado`, p: 50 }); checkBadges(); save(); }
  beep(1050); fb(`¡Nivel ${lv} superado!` + (data.autoNext !== false && lv < 15 ? " Pasando al siguiente nivel…" : ""), "ok");
  renderLevels(); render(); renderStats();
  if (data.autoNext !== false && lv < 15 && unlocked(lv + 1)) nextT = setTimeout(() => selectLevel(lv + 1), 2500);
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
  auto = false; phase = "idle"; stuck = false; holdStart = 0; hbar(0); clearTimeout(nextT);
  fb("Nivel detenido. Pulsa «Iniciar nivel» para continuar."); render();
}

async function startLevel() {
  if (auto) { stopAuto(); return; }
  const l = L(lv);
  if (l.type === "phrases") { fb("Las frases aún no tienen detección automática ni referencias validadas.", "warn"); return; }
  if (!camOn) { await camStart(); if (!camOn) return; }
  data.landmarks = true; $("optLandmarks").checked = true; save();
  if (!lm) fb("Cargando el detector de manos… (la primera vez puede tardar)");
  await startLM();
  if (!lm) { fb("No se pudo cargar el detector (¿sin internet?). Usa «Práctica manual».", "warn"); return; }
  reset();
  queue = l.items.filter(i => !isDone(l, i)); if (!queue.length) queue = [...l.items];
  qi = 0; idx = l.items.indexOf(queue[0]);
  auto = true; phase = "auto"; since = performance.now() + 800; cool = since;
  if (narrow()) $("camBox").scrollIntoView({ behavior: "smooth", block: "center" });
  fb(`Haz la seña que se muestra y mantenla: ${queue[0]}`); render();
}

function camStop() {
  if (auto) { auto = false; phase = "idle"; fb("Cámara apagada: nivel en pausa.", "warn"); }
  camStopBase(); hbar(0);
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
  $("soundToggle").checked = !!data.sound;
}
$("restartBtn").onclick = restartLevel;
$("openSettings").addEventListener("click", syncSettings);
$("optOverlay").onchange = e => { data.overlay = e.target.checked; save(); if (!data.overlay) { const c = $("overlay"); c.getContext("2d").clearRect(0, 0, c.width, c.height); } };
$("optAutoNext").onchange = e => { data.autoNext = e.target.checked; save(); };
$("optHold").onchange = e => { data.hold = Number(e.target.value); save(); toast("Tiempo de sostén actualizado"); };
$("optTol").onchange = e => { data.tol = Number(e.target.value); save(); toast("Exigencia actualizada"); };
$("resetSettings").onclick = () => {
  data.overlay = true; data.autoNext = true; data.hold = HOLD_MS; data.tol = TOL; data.sound = true; save(); syncSettings(); toast("Ajustes restablecidos");
};

/* ===== ESTADO VISUAL DE LA CÁMARA =====
   Se actualiza cuando algo cambia (render, bucle de detección, cámara),
   ya no con un temporizador que corre todo el tiempo. */
function updateCamState() {
  const state = !camOn ? "off" : !hand ? "idle" : (auto && holdStart ? "hold" : "hand");
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