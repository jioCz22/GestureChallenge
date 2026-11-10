
"use strict";

/* =========================================================
   GESTURECHALLENGE — BASE DE DATOS DIDÁCTICA
   15 niveles: letras, palabras y frases.
========================================================= */


/* =========================================================
   ABECEDARIO MANUAL
========================================================= */

const ALL = [
  "A", "B", "C", "D", "E", "F",
  "G", "H", "I", "J", "K", "L",
  "M", "N", "Ñ", "O", "P", "Q",
  "R", "S", "T", "U", "V",
  "W", "X", "Y", "Z"
];


/* =========================================================
   ETAPAS
========================================================= */

const STAGES = [
  "Etapa 1 · Letras",
  "Etapa 2 · Palabras",
  "Etapa 3 · Frases"
];


/* =========================================================
   DISTRIBUCIÓN DE NIVELES
========================================================= */

const STAGE_LV = [
  [1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10],
  [11, 12, 13, 14, 15]
];


/* =========================================================
   NIVELES
========================================================= */

const LEVELS = [

  /* ETAPA 1 — LETRAS */

  {
    n: 1,
    stage: 0,
    type: "letters",
    name: "Primer contacto",
    goal: "Aprende las primeras seis letras del abecedario manual.",
    items: ["A", "B", "C", "D", "E", "F"]
  },

  {
    n: 2,
    stage: 0,
    type: "letters",
    name: "Nuevas formas",
    goal: "Identifica y practica seis nuevas configuraciones manuales.",
    items: ["G", "H", "I", "J", "K", "L"]
  },

  {
    n: 3,
    stage: 0,
    type: "letters",
    name: "Ampliando el alfabeto",
    goal: "Continúa con las letras M, N, Ñ, O, P y Q.",
    items: ["M", "N", "Ñ", "O", "P", "Q"]
  },

  {
    n: 4,
    stage: 0,
    type: "letters",
    name: "Precisión manual",
    goal: "Practica las letras R, S, T, U y V.",
    items: ["R", "S", "T", "U", "V"]
  },

  {
    n: 5,
    stage: 0,
    type: "letters",
    name: "Dominio del alfabeto",
    goal: "Completa el abecedario manual con las últimas cuatro letras.",
    items: ["W", "X", "Y", "Z"]
  },


  /* ETAPA 2 — PALABRAS */

  {
    n: 6,
    stage: 1,
    type: "words",
    name: "Palabras iniciales",
    goal: "Practica el deletreo manual de palabras cortas.",
    items: [
      "HOLA",
      "CASA",
      "MESA",
      "LUNA",
      "GATO"
    ]
  },

  {
    n: 7,
    stage: 1,
    type: "words",
    name: "Comunicación cotidiana",
    goal: "Practica palabras utilizadas en conversaciones cotidianas.",
    items: [
      "GRACIAS",
      "AMIGO",
      "FAMILIA",
      "AGUA",
      "COMIDA"
    ]
  },

  {
    n: 8,
    stage: 1,
    type: "words",
    name: "Personas y emociones",
    goal: "Mejora tu precisión al deletrear palabras relacionadas con personas y emociones.",
    items: [
      "AMOR",
      "FELIZ",
      "PERSONA",
      "MADRE",
      "PADRE"
    ]
  },

  {
    n: 9,
    stage: 1,
    type: "words",
    name: "Entorno y actividades",
    goal: "Practica palabras de tu entorno y actividades habituales.",
    items: [
      "ESCUELA",
      "TRABAJO",
      "LIBRO",
      "AMISTAD",
      "MUNDO"
    ]
  },

  {
    n: 10,
    stage: 1,
    type: "words",
    name: "Reto de palabras",
    goal: "Demuestra precisión y continuidad al deletrear palabras más largas.",
    items: [
      "TECNOLOGIA",
      "APRENDER",
      "COMUNICACION",
      "CONOCIMIENTO",
      "DESARROLLO"
    ]
  },


  /* ETAPA 3 — FRASES */

  {
    n: 11,
    stage: 2,
    type: "phrases",
    name: "Expresiones básicas",
    goal: "Comienza a practicar expresiones completas en LSM.",
    items: [
      "HOLA, ¿COMO ESTAS?",
      "MUCHO GUSTO",
      "BUENOS DIAS",
      "BUENAS NOCHES"
    ]
  },

  {
    n: 12,
    stage: 2,
    type: "phrases",
    name: "Comunicación personal",
    goal: "Practica expresiones relacionadas con información personal.",
    items: [
      "MI NOMBRE ES...",
      "¿COMO TE LLAMAS?",
      "SOY DE MEXICO",
      "MUCHO GUSTO EN CONOCERTE"
    ]
  },

  {
    n: 13,
    stage: 2,
    type: "phrases",
    name: "Interacción cotidiana",
    goal: "Aprende a practicar situaciones comunes de comunicación.",
    items: [
      "POR FAVOR",
      "MUCHAS GRACIAS",
      "¿PUEDES AYUDARME?",
      "NO ENTIENDO"
    ]
  },

  {
    n: 14,
    stage: 2,
    type: "phrases",
    name: "Expresión y comprensión",
    goal: "Avanza hacia expresiones más completas.",
    items: [
      "QUIERO APRENDER",
      "ESTOY ESTUDIANDO",
      "ME GUSTA APRENDER",
      "¿PUEDES REPETIR?"
    ]
  },

  {
    n: 15,
    stage: 2,
    type: "phrases",
    name: "Desafío final",
    goal: "Consolida tu aprendizaje mediante expresiones completas.",
    items: [
      "HOLA, MI NOMBRE ES...",
      "ESTOY APRENDIENDO LSM",
      "GRACIAS POR TU AYUDA",
      "ME GUSTA COMUNICARME CONTIGO"
    ]
  }

];


/* =========================================================
   REFERENCIAS VISUALES
========================================================= */

/*
  Estructura de cada recurso:

  img: ruta de imagen.
  video: ruta de video.
  desc: descripción.
  tips: consejos.
  variants: variantes documentadas.

  IMPORTANTE:
  Las rutas de imágenes deben corresponder a archivos reales.
  No se incluyen imágenes ficticias ni se presentan como
  referencias verificadas.
*/

const RES = {};


/* Referencias del abecedario */

ALL.forEach(letter => {

  RES[letter] = {

    img: `assets/letras/${letter}.png`,

    desc: `Referencia visual de la letra ${letter} del abecedario manual de la LSM.`,

    tips: [
      "Observa la orientación de la palma.",
      "Compara la posición de los dedos.",
      "Revisa la configuración de la mano."
    ],

    variants: []

  };

});


/* =========================================================
   REFERENCIAS DE FRASES
========================================================= */

/*
  Las frases necesitan recursos audiovisuales revisados
  por personas competentes en LSM.

  Se crean sus entradas sin inventar videos ni señas.
  Para habilitar una frase, agrega un video verificado:

  RES["HOLA, ¿COMO ESTAS?"].video =
    "assets/frases/hola-como-estas.mp4";
*/

LEVELS
  .filter(level => level.type === "phrases")
  .forEach(level => {

    level.items.forEach(phrase => {

      RES[phrase] = {

        desc: "Referencia pendiente de validación en LSM.",

        tips: [],

        variants: []

      };

    });

  });


/* =========================================================
   INSIGNIAS
========================================================= */

/*
  Formato:
  [identificador, nombre, descripción, condición]
*/

const BADGES = [

  [
    "first",
    "Primer paso",
    "Completa tu primera práctica.",
    d => d.done.length + d.words.length + d.phrases.length >= 1
  ],

  [
    "letters",
    "Explorador del alfabeto",
    "Completa diez letras.",
    d => d.done.length >= 10
  ],

  [
    "alphabet",
    "Alfabeto completo",
    "Completa las 27 letras.",
    d => d.done.length >= 27
  ],

  [
    "word",
    "Primera palabra",
    "Completa tu primera palabra.",
    d => d.words.length >= 1
  ],

  [
    "words10",
    "Constructor de palabras",
    "Completa diez palabras.",
    d => d.words.length >= 10
  ],

  [
    "phrase",
    "Primera expresión",
    "Completa tu primera frase.",
    d => d.phrases.length >= 1
  ],

  [
    "phrases10",
    "Comunicador",
    "Completa diez frases.",
    d => d.phrases.length >= 10
  ],

  [
    "levels5",
    "En progreso",
    "Supera cinco niveles.",
    d => d.levels.length >= 5
  ],

  [
    "levels10",
    "Avanzado",
    "Supera diez niveles.",
    d => d.levels.length >= 10
  ],

  [
    "master",
    "Gesture Master",
    "Supera los quince niveles.",
    d => d.levels.length >= 15
  ],

  [
    "points500",
    "Acumulador",
    "Consigue 500 puntos.",
    d => d.points >= 500
  ],

  [
    "streak3",
    "Constancia",
    "Consigue una racha de tres días.",
    d => d.streak >= 3
  ]

];


/* La imagen de referencia del proyecto no incluye la Ñ */
delete RES["Ñ"].img;
RES["Ñ"].desc = "La imagen de referencia del proyecto no incluye la Ñ. Consulta una fuente confiable de LSM y agrega su recurso aquí.";
RES["Ñ"].tips = [];


/* =========================================================
   REGLAS DE DETECCIÓN AUTOMÁTICA (MODO AUTÓNOMO)
========================================================= */
/*
  Describen la forma de la mano que se espera para cada letra, leída
  de tu imagen de referencia. NO es un clasificador entrenado ni validado
  con personas usuarias de LSM: es una comprobación geométrica aproximada.
  Si una letra no se detecta bien, ajusta su regla aquí.

  f:  [índice, medio, anular, meñique]  0 = doblado, 1 = extendido,
      2 = a medio doblar, -1 = no importa
  th: pulgar  0 = pegado a la mano, 1 = separado, 2 = en pinza con el índice, -1 = no importa
  o:  orientación de la mano  "up" | "side" | "down" | "any"
  sp: separación índice–medio  "together" | "apart"  (opcional)
  mv: punto de la mano que debe moverse (8 = punta del índice, 20 = meñique) para letras con movimiento
*/
const TOL = 0.5; // tolerancia: 0 = estricto
const HOLD_MS = 900; // tiempo que debes mantener la seña
const SHAPES = {
  A: { f: [0,0,0,0], th: 1, o: "up" },
  B: { f: [1,1,1,1], th: 0, o: "up" },
  C: { f: [2,2,2,2], th: 1, o: "any" },
  D: { f: [1,0,0,0], th: 0, o: "up" },
  E: { f: [2,2,2,2], th: 0, o: "up" },
  F: { f: [-1,1,1,1], th: 2, o: "up" },
  G: { f: [1,0,0,0], th: 1, o: "side" },
  H: { f: [1,1,0,0], th: -1, o: "side" },
  I: { f: [0,0,0,1], th: 0, o: "up" },
  J: { f: [0,0,0,1], th: 0, o: "up", mv: 20 },
  K: { f: [1,1,0,0], th: 1, o: "up", sp: "apart", mv: 8 },
  L: { f: [1,0,0,0], th: 1, o: "up" },
  M: { f: [0,0,0,0], th: 0, o: "down" },
  N: { f: [0,0,0,0], th: 0, o: "down" },
  O: { f: [2,2,2,2], th: 2, o: "up" },
  P: { f: [1,1,0,0], th: 1, o: "down" },
  Q: { f: [1,0,0,0], th: 1, o: "down", mv: 8 },
  R: { f: [1,1,0,0], th: 0, o: "up", sp: "together" },
  S: { f: [0,0,0,0], th: 0, o: "up" },
  T: { f: [0,0,0,0], th: 0, o: "up" },
  U: { f: [1,1,0,0], th: 0, o: "up", sp: "together" },
  V: { f: [1,1,0,0], th: 0, o: "up", sp: "apart" },
  W: { f: [1,1,1,0], th: 0, o: "up" },
  X: { f: [2,0,0,0], th: 0, o: "side", mv: 8 },
  Y: { f: [0,0,0,1], th: 1, o: "up" },
  Z: { f: [1,0,0,0], th: 0, o: "up", mv: 8 }
  /* Ñ: sin regla (no hay referencia): se confirma con autoevaluación */
};
