import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js";

import { FBXLoader } from "https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/FBXLoader.js";

// --------------------------------------------------
// CONFIGURACIÓN DE TARGETS Y MODELOS
// --------------------------------------------------

const TARGETS = [
  {
    name: "Piedra",
    modelName: "Roca",
    modelPath: new URL("../Modelo/Roca.fbx", import.meta.url).href,
    texturePath: new URL(
      "../Modelo/TexturasRoca/Stylized Rock 001 Base (Normal).png",
      import.meta.url
    ).href,
    maxSize: 0.85
  },
  {
    name: "Papel",
    modelName: "Papel",
    modelPath: new URL("../Modelo/Paper.fbx", import.meta.url).href,
    texturePath: new URL(
      "../Modelo/TexturasPapel/paper tablet_Material_BaseColor.png",
      import.meta.url
    ).href,
    maxSize: 0.85
  },
  {
    name: "Tijera",
    modelName: "Tijera",
    modelPath: new URL("../Modelo/scissors.fbx", import.meta.url).href,
    texturePath: new URL(
      "../Modelo/TexturasTijeras/scissors_BaseColor.openPBR_shader1.jpg",
      import.meta.url
    ).href,
    maxSize: 0.85
  }
];

// --------------------------------------------------
// ESTADO DE LA EXPERIENCIA
// --------------------------------------------------

const state = {
  mindar: null,
  anchors: [],
  models: [],
  selected: new Set(),

  round: 1,
  totalRounds: 3,

  detectionMode: "sequential",

  score: {
    playerOne: 0,
    playerTwo: 0
  },

  tieBreakerPending: false,
  tieBreakerUsed: false,

  phase: "idle"
};

// --------------------------------------------------
// ELEMENTOS HTML
// --------------------------------------------------

const elements = {
  intro: document.querySelector("#intro-panel"),

  status: document.querySelector("#status-panel"),
  statusMessage: document.querySelector("#status-message"),

  ar: document.querySelector("#ar-container"),

  result: document.querySelector("#result-panel"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),

  figures: document.querySelector("#figures-played"),
  scoreboard: document.querySelector("#scoreboard"),

  round: document.querySelector("#round-indicator"),
  roundsInput: document.querySelector("#rounds-input"),

  start: document.querySelector("#start-button"),
  next: document.querySelector("#next-round-button")
};

// --------------------------------------------------
// LOADERS
// --------------------------------------------------

const fbxLoader = new FBXLoader();
const textureLoader = new THREE.TextureLoader();

// --------------------------------------------------
// FUNCIONES GENERALES
// --------------------------------------------------

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(
    navigator.userAgent
  );
}

// --------------------------------------------------
// PREPARACIÓN DE CÁMARA
// --------------------------------------------------

async function prepareCamera() {

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Este navegador no permite acceder a una cámara."
    );
  }

  const constraints = isMobile()
    ? {
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      }
    : {
        video: true,
        audio: false
      };

  const stream = await navigator.mediaDevices.getUserMedia(
    constraints
  );

  stream.getTracks().forEach((track) => track.stop());

  const cameras = (
    await navigator.mediaDevices.enumerateDevices()
  ).filter(({ kind }) => kind === "videoinput");

  if (!cameras.length) {
    throw new Error(
      "No se encontró ninguna cámara disponible."
    );
  }

  const preferred = isMobile()
    ? cameras.find(({ label }) =>
        /back|rear|environment|trasera|posterior/i.test(label)
      )
    : cameras[0];

  return preferred?.deviceId || null;
}

// --------------------------------------------------
// APLICAR TEXTURAS A LOS MODELOS
// --------------------------------------------------

function applyTextureToModel(model, texture) {

  model.traverse((child) => {

    if (!child.isMesh) return;

    child.castShadow = true;
    child.receiveShadow = true;

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    materials.forEach((material, index) => {

      if (!material) {

        materials[index] = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.75,
          metalness: 0.05
        });

        return;
      }

      material.map = texture;

      if (material.color) {
        material.color.set(0xffffff);
      }

      material.needsUpdate = true;

    });

    child.material = Array.isArray(child.material)
      ? materials
      : materials[0];

  });

}

// --------------------------------------------------
// NORMALIZAR TAMAÑO Y POSICIÓN DE MODELOS
// --------------------------------------------------

function normalizeModel(model, maxSize = 0.85) {

  let bounds = new THREE.Box3().setFromObject(model);

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  bounds.getSize(size);
  bounds.getCenter(center);

  const largestDimension = Math.max(
    size.x,
    size.y,
    size.z
  );

  if (largestDimension > 0) {

    const scale = maxSize / largestDimension;

    model.scale.setScalar(scale);

  }

  // Actualizar límites después de escalar.

  bounds = new THREE.Box3().setFromObject(model);

  bounds.getCenter(center);

  // Centrar el modelo respecto al anchor.

  model.position.sub(center);

}

// --------------------------------------------------
// CARGAR UN MODELO FBX
// --------------------------------------------------

async function loadTargetModel(target) {

  console.log(
    `[MODELO] Cargando ${target.modelName}...`
  );

  const [fbx, texture] = await Promise.all([

    fbxLoader.loadAsync(target.modelPath),

    textureLoader.loadAsync(target.texturePath)

  ]);

  // Configuración de textura.

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;

  // Aplicar textura.

  applyTextureToModel(fbx, texture);

  // Normalizar tamaño.

  normalizeModel(fbx, target.maxSize);

  // Crear contenedor independiente.

  const modelRoot = new THREE.Group();

  modelRoot.add(fbx);

  console.log(
    `[MODELO] ${target.modelName} cargado correctamente.`
  );

  return modelRoot;

}

// --------------------------------------------------
// CARGAR TODOS LOS MODELOS
// --------------------------------------------------

async function loadAllModels() {

  const loadedModels = await Promise.all(

    TARGETS.map((target) =>
      loadTargetModel(target)
    )

  );

  state.models = loadedModels;

  return loadedModels;

}

// --------------------------------------------------
// LÓGICA DEL JUEGO
// --------------------------------------------------

function getResult(first, second) {

  if (first === second) {

    return {
      title: "¡EMPATE!",
      message: "Ambos jugadores eligieron la misma figura.",
      winner: null
    };

  }

  const winsAgainst = {

    Piedra: "Tijera",
    Papel: "Piedra",
    Tijera: "Papel"

  };

  const winner = winsAgainst[first] === second
    ? first
    : second;

  const messages = {

    Piedra: "La piedra aplasta la tijera.",
    Papel: "El papel envuelve la piedra.",
    Tijera: "La tijera corta el papel."

  };

  return {

    title: `¡${winner.toUpperCase()} GANA!`,

    message: messages[winner],

    winner

  };

}

// --------------------------------------------------
// FINALIZAR RONDA
// --------------------------------------------------

function finishRound() {

  if (
    state.selected.size !== 2 ||
    state.phase !== "scanning"
  ) {
    return;
  }

  state.phase = "result";

  const [first, second] = [...state.selected].map(
    (targetIndex) => TARGETS[targetIndex].name
  );

  const result = getResult(first, second);

  const roundWinner = result.winner
    ? result.winner === first
      ? "playerOne"
      : "playerTwo"
    : null;

  if (roundWinner) {
    state.score[roundWinner] += 1;
  }

  const scores = Object.values(state.score);

  const highestScore = Math.max(...scores);

  const leaders = Object.keys(state.score).filter(
    (player) => state.score[player] === highestScore
  );

  const sessionIsTied = leaders.length > 1;

  const isConfiguredFinal =
    state.round >= state.totalRounds &&
    !state.tieBreakerUsed;

  const requiresTieBreaker =
    isConfiguredFinal && sessionIsTied;

  const isTieBreakerFinal = state.tieBreakerUsed;

  elements.resultTitle.textContent = roundWinner
    ? `¡${
        roundWinner === "playerOne"
          ? "JUGADOR A"
          : "JUGADOR B"
      } GANA!`
    : result.title;

  elements.resultMessage.textContent = result.message;

  elements.figures.textContent =
    `Jugador A: ${first} · Jugador B: ${second}`;

  elements.scoreboard.textContent =
    `Puntaje: Jugador A ${state.score.playerOne} · Jugador B ${state.score.playerTwo}`;

  elements.result.hidden = false;
  elements.status.hidden = true;

  if (requiresTieBreaker) {

    state.tieBreakerPending = true;

    elements.next.disabled = false;

    elements.next.textContent = "RONDA DE DESEMPATE";

  } else {

    state.tieBreakerPending = false;

    elements.next.disabled =
      isTieBreakerFinal ||
      state.round >= state.totalRounds;

    elements.next.textContent = elements.next.disabled
      ? "JUEGO TERMINADO"
      : "SIGUIENTE RONDA";

  }

}

// --------------------------------------------------
// RECONOCIMIENTO DE TARGETS
// --------------------------------------------------

function handleTargetFound(index) {

  if (
    state.phase !== "scanning" ||
    state.selected.has(index)
  ) {
    return;
  }

  const targetName = TARGETS[index].name;

  console.log(
    `[MINDAR] Target encontrado: ${targetName}`
  );

  state.selected.add(index);

  const playerNumber = state.selected.size;

  const isComplete = state.selected.size === 2;

  setStatus(

    isComplete

      ? "Dos figuras detectadas. Procesando resultado..."

      : state.detectionMode === "simultaneous"

        ? "Ambos jugadores deben mostrar su figura. Falta una detección."

        : `Jugador ${
            playerNumber === 1 ? 2 : 1
          }: muestra tu figura.`

  );

  if (isComplete) {
    finishRound();
  }

}

// --------------------------------------------------
// INICIAR EXPERIENCIA
// --------------------------------------------------

async function startExperience() {

  if (state.phase !== "idle") return;

  state.phase = "loading";

  state.totalRounds = Math.min(
    99,
    Math.max(
      1,
      Number.parseInt(elements.roundsInput.value, 10) || 3
    )
  );

  state.detectionMode = document.querySelector(
    'input[name="detection-mode"]:checked'
  ).value;

  state.round = 1;

  state.score = {
    playerOne: 0,
    playerTwo: 0
  };

  state.tieBreakerPending = false;
  state.tieBreakerUsed = false;

  state.selected.clear();

  state.anchors = [];
  state.models = [];

  elements.round.textContent =
    `Ronda 1 de ${state.totalRounds}`;

  elements.start.disabled = true;

  setStatus(
    "Solicitando acceso a la cámara y cargando los modelos 3D..."
  );

  try {

    // ----------------------------------------------
    // PREPARAR CÁMARA
    // ----------------------------------------------

    const cameraId = await prepareCamera();

    console.log("[AR] Inicializando MindAR...");

    console.log(
      "[AR] Cámara seleccionada:",
      cameraId
    );

    console.log(
      "[AR] Targets configurados:",
      TARGETS
    );

    // ----------------------------------------------
    // CARGAR MODELOS FBX
    // ----------------------------------------------

    const models = await loadAllModels();

    // ----------------------------------------------
    // CONFIGURAR MINDAR
    // ----------------------------------------------

    const mindar = new MINDAR.IMAGE.MindARThree({

      container: elements.ar,

      imageTargetSrc: "./Targets/Los3Targets.mind",

      maxTrack: 2,

      environmentDeviceId: cameraId,

      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",

      warmupTolerance: 4,
      missTolerance: 8

    });

    state.mindar = mindar;

    // ----------------------------------------------
    // CREAR ANCHORS Y ASIGNAR MODELOS
    // ----------------------------------------------

    TARGETS.forEach((target, index) => {

      const anchor = mindar.addAnchor(index);

      const model = models[index];

      // Asignar directamente el modelo FBX al anchor.

      anchor.group.add(model);

      // --------------------------------------------
      // TARGET DETECTADO
      // --------------------------------------------

      anchor.onTargetFound = () => {

        anchor.group.visible = true;

        model.visible = true;

        console.log(
          `[MINDAR] Target detectado: ${target.name}`
        );

        setStatus(
          `Target detectado: ${target.name}`
        );

        handleTargetFound(index);

      };

      // --------------------------------------------
      // TARGET PERDIDO
      // --------------------------------------------

      anchor.onTargetLost = () => {

        console.log(
          `[MINDAR] Target perdido: ${target.name}`
        );

        // En modo simultáneo se requiere mantener
        // ambas figuras visibles.

        if (
          state.detectionMode === "simultaneous" &&
          state.phase === "scanning"
        ) {

          state.selected.delete(index);

          setStatus(
            "Ambos jugadores deben mantener sus figuras visibles."
          );

        }

      };

      state.anchors.push(anchor);

    });

    // ----------------------------------------------
    // ILUMINACIÓN
    // ----------------------------------------------

    const hemisphereLight = new THREE.HemisphereLight(
      0xffffff,
      0x304038,
      2
    );

    const directionalLight = new THREE.DirectionalLight(
      0xffffff,
      1.5
    );

    directionalLight.position.set(1, 2, 3);

    mindar.scene.add(hemisphereLight);

    mindar.scene.add(directionalLight);

    // ----------------------------------------------
    // PREPARAR INTERFAZ
    // ----------------------------------------------

    elements.intro.hidden = true;

    elements.ar.style.display = "block";

    state.phase = "scanning";

    setStatus(

      state.detectionMode === "simultaneous"

        ? "Jugador A y Jugador B: muestren sus figuras al mismo tiempo."

        : "Jugador A: muestra tu figura."

    );

    // ----------------------------------------------
    // INICIAR MINDAR
    // ----------------------------------------------

    await mindar.start();

    console.log(
      "[AR] MindAR iniciado correctamente."
    );

    console.log(
      "[AR] Cámara activa:",
      mindar.video
    );

    // ----------------------------------------------
    // BUCLE DE RENDERIZADO
    // ----------------------------------------------

    mindar.renderer.setAnimationLoop(() => {

      mindar.renderer.render(
        mindar.scene,
        mindar.camera
      );

    });

  } catch (error) {

    console.error(
      "[AR] Error al iniciar la experiencia:",
      error
    );

    // Intentar detener MindAR si alcanzó a iniciarse.

    if (state.mindar) {

      try {

        state.mindar.stop();

      } catch (stopError) {

        console.warn(
          "[AR] No se pudo detener MindAR:",
          stopError
        );

      }

    }

    state.mindar = null;

    state.phase = "idle";

    elements.start.disabled = false;

    const message =
      error?.message || "Error desconocido";

    setStatus(

      error?.name === "NotAllowedError"

        ? "Permiso de cámara rechazado. Autoriza la cámara y vuelve a intentarlo."

        : `No se pudo iniciar la experiencia: ${message}`

    );

  }

}

// --------------------------------------------------
// SIGUIENTE RONDA
// --------------------------------------------------

function nextRound() {

  if (
    !state.mindar ||
    state.phase !== "result"
  ) {
    return;
  }

  // Limpiar selecciones anteriores.

  state.selected.clear();

  // Incrementar ronda.

  state.round += 1;

  if (state.tieBreakerPending) {

    state.tieBreakerUsed = true;

  }

  elements.next.disabled = false;

  state.phase = "scanning";

  elements.round.textContent = state.tieBreakerUsed

    ? `Desempate · Ronda ${state.round}`

    : `Ronda ${state.round} de ${state.totalRounds}`;

  elements.result.hidden = true;

  elements.status.hidden = false;

  // Comprobar si los targets siguen visibles.

  state.anchors.forEach((anchor, index) => {

    if (anchor.group.visible) {

      state.selected.add(index);

    }

  });

  if (state.selected.size === 2) {

    setStatus(
      "Dos figuras visibles. Procesando resultado..."
    );

    finishRound();

  } else {

    setStatus(

      state.detectionMode === "simultaneous"

        ? "Jugador A y Jugador B: muestren sus figuras al mismo tiempo."

        : state.selected.size === 1

          ? "Jugador B: muestra tu figura."

          : "Jugador A: muestra tu figura."

    );

  }

  console.log(
    `[JUEGO] Comenzando ronda ${state.round}`
  );

}

// --------------------------------------------------
// EVENTOS
// --------------------------------------------------

elements.start.addEventListener(
  "click",
  startExperience
);

elements.next.addEventListener(
  "click",
  nextRound
);