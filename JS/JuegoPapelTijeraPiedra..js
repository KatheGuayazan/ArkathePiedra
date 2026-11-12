import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js";

// --------------------------------------------------
// CONFIGURACIÓN DE TARGETS
// Los tres targets están compilados en Los3Targets.mind
// --------------------------------------------------

const TARGETS = [
  {
    name: "Piedra",
    modelName: "Piedra"
  },
  {
    name: "Papel",
    modelName: "Papel"
  },
  {
    name: "Tijera",
    modelName: "Tijera"
  }
];

// --------------------------------------------------
// ESTADO DE LA EXPERIENCIA
// --------------------------------------------------

const state = {
  mindar: null,
  anchors: [],
  models: [],
  persistentModels: [],
  selected: new Set(),
  round: 1,
  totalRounds: 3,
  detectionMode: "sequential",
  score: { playerOne: 0, playerTwo: 0 },
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
// FUNCIONES GENERALES
// --------------------------------------------------

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
}

// --------------------------------------------------
// PREPARACIÓN DE CÁMARA
// --------------------------------------------------

async function prepareCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador no permite acceder a una cámara.");
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

  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  stream.getTracks().forEach((track) => track.stop());

  const cameras = (await navigator.mediaDevices.enumerateDevices())
    .filter(({ kind }) => kind === "videoinput");

  if (!cameras.length) {
    throw new Error("No se encontró ninguna cámara disponible.");
  }

  const preferred = isMobile()
    ? cameras.find(({ label }) =>
        /back|rear|environment|trasera|posterior/i.test(label)
      )
    : cameras[0];

  return preferred?.deviceId || null;
}

// --------------------------------------------------
// MODELOS TEMPORALES PARA COMPROBAR EL TRACKING
// --------------------------------------------------

function createDefaultModel(targetName) {
  const geometries = {
    Piedra: new THREE.BoxGeometry(0.9, 0.9, 0.9),
    Papel: new THREE.CylinderGeometry(0.55, 0.55, 0.18, 32),
    Tijera: new THREE.SphereGeometry(0.65, 32, 24)
  };

  const colors = {
    Piedra: 0x777777,
    Papel: 0xe9e1c8,
    Tijera: 0xF527F5
  };

  const mesh = new THREE.Mesh(
    geometries[targetName],
    new THREE.MeshStandardMaterial({
      color: colors[targetName],
      roughness: 0.7,
      metalness: 0.15
    })
  );

  mesh.rotation.x = targetName === "Papel" ? Math.PI / 2 : 0;

  return mesh;
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

  const winner = winsAgainst[first] === second ? first : second;

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

function finishRound() {
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
  if (roundWinner) state.score[roundWinner] += 1;
  const scores = Object.values(state.score);
  const highestScore = Math.max(...scores);
  const leaders = Object.keys(state.score).filter(
    (player) => state.score[player] === highestScore
  );
  const sessionIsTied = leaders.length > 1;
  const isConfiguredFinal =
    state.round >= state.totalRounds && !state.tieBreakerUsed;
  const requiresTieBreaker = isConfiguredFinal && sessionIsTied;
  const isTieBreakerFinal = state.tieBreakerUsed;

  elements.resultTitle.textContent = roundWinner
    ? `¡${roundWinner === "playerOne" ? "JUGADOR A" : "JUGADOR B"} GANA!`
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
    elements.next.disabled = isTieBreakerFinal || state.round >= state.totalRounds;
    elements.next.textContent = elements.next.disabled
      ? "JUEGO TERMINADO"
      : "SIGUIENTE RONDA";
  }
}

// --------------------------------------------------
// OCULTAR MODELOS 3D
// --------------------------------------------------

function hideModels() {
  state.models.forEach((model) => {
    model.visible = false;
  });

  console.log("[AR] Todos los modelos han sido ocultados.");
}

// --------------------------------------------------
// MOSTRAR MODELOS 3D
// --------------------------------------------------

function showModels() {
  state.models.forEach((model) => {
    model.visible = true;
  });

  console.log("[AR] Todos los modelos están disponibles nuevamente.");
}

// --------------------------------------------------
// RECONOCIMIENTO DE TARGETS
// --------------------------------------------------

function handleTargetFound(index) {
  if (state.phase !== "scanning" || state.selected.has(index)) {
    return;
  }

  const targetName = TARGETS[index].name;

  console.log(`[MINDAR] Target encontrado: ${targetName}`);

  state.selected.add(index);
  const playerNumber = state.selected.size;

  const isComplete = state.selected.size === 2;
  setStatus(
    isComplete
      ? "Dos figuras detectadas. Procesando resultado..."
      : state.detectionMode === "simultaneous"
        ? "Ambos jugadores deben mostrar su figura. Falta una detección."
        : `Jugador ${playerNumber === 1 ? 2 : 1}: muestra tu figura.`
  );

  if (isComplete) finishRound();
}

// --------------------------------------------------
// INICIAR EXPERIENCIA
// --------------------------------------------------

async function startExperience() {
  if (state.phase !== "idle") return;

  state.phase = "loading";
  state.totalRounds = Math.min(
    99,
    Math.max(1, Number.parseInt(elements.roundsInput.value, 10) || 3)
  );
  state.detectionMode = document.querySelector(
    'input[name="detection-mode"]:checked'
  ).value;
  state.round = 1;
  state.score = { playerOne: 0, playerTwo: 0 };
  state.tieBreakerPending = false;
  state.tieBreakerUsed = false;
  state.selected.clear();
  elements.round.textContent = `Ronda 1 de ${state.totalRounds}`;

  elements.start.disabled = true;

  setStatus("Solicitando acceso a la cámara y preparando la experiencia...");

  try {
    const cameraId = await prepareCamera();

    console.log("[AR] Inicializando MindAR...");
    console.log("[AR] Cámara seleccionada:", cameraId);
    console.log("[AR] Targets configurados:", TARGETS);

    const mindar = new MINDAR.IMAGE.MindARThree({
      container: elements.ar,

      // Archivo que contiene los tres targets.
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

    // Crear los modelos temporales.
    const models = TARGETS.map((target) =>
      createDefaultModel(target.modelName)
    );

    state.models = models;

    // Crear un anchor por cada imagen del archivo .mind.
    TARGETS.forEach((target, index) => {
      const anchor = mindar.addAnchor(index);

      anchor.group.add(models[index]);

      anchor.onTargetFound = () => {
        anchor.group.visible = true;
        models[index].visible = true;
        if (!state.persistentModels[index]) {
          const persistentModel = models[index].clone();
          persistentModel.matrixAutoUpdate = false;
          state.persistentModels[index] = persistentModel;
          mindar.scene.add(persistentModel);
        }
        state.persistentModels[index].matrix
          .copy(anchor.group.matrix)
          .multiply(models[index].matrix);
        state.persistentModels[index].visible = true;
        setStatus(`Target detectado: ${target.name}`);
        handleTargetFound(index);
      };

      anchor.onTargetLost = () => {
        console.log(`[MINDAR] Target perdido: ${target.name}`);
        if (state.persistentModels[index]) {
          state.persistentModels[index].visible = true;
        }
        if (state.detectionMode === "simultaneous" && state.phase === "scanning") {
          state.selected.delete(index);
          setStatus("Ambos jugadores deben mantener sus figuras visibles.");
        }
      };

      anchor.onTargetUpdate = () => {
        if (state.persistentModels[index]) {
          state.persistentModels[index].matrix
            .copy(anchor.group.matrix)
            .multiply(models[index].matrix);
          state.persistentModels[index].visible = true;
        }
      };

      state.anchors.push(anchor);
    });

    // Iluminación.
    const light = new THREE.HemisphereLight(
      0xffffff,
      0x304038,
      2
    );

    mindar.scene.add(light);

    elements.intro.hidden = true;
    elements.ar.style.display = "block";

    state.phase = "scanning";

    setStatus(
      state.detectionMode === "simultaneous"
        ? "Jugador A y Jugador B: muestren sus figuras al mismo tiempo."
        : "Jugador A: muestra tu figura."
    );

    await mindar.start();

    console.log("[AR] MindAR iniciado correctamente.");
    console.log("[AR] Cámara activa:", mindar.video);

    mindar.renderer.setAnimationLoop(() => {
      mindar.renderer.render(
        mindar.scene,
        mindar.camera
      );
    });

  } catch (error) {
    console.error("[AR] Error al iniciar MindAR:", error);

    state.phase = "idle";

    elements.start.disabled = false;

    const message = error?.message || "Error desconocido";

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
  if (!state.mindar) return;

  // Limpiar las selecciones anteriores.
  state.selected.clear();

  // Incrementar el número de ronda.
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

  state.anchors.forEach((anchor, index) => {
    if (anchor.visible) state.selected.add(index);
  });

  if (state.selected.size === 2) {
    setStatus("Dos figuras visibles. Procesando resultado...");
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

  console.log(`[JUEGO] Comenzando ronda ${state.round}`);

}

// --------------------------------------------------
// EVENTOS
// --------------------------------------------------

elements.start.addEventListener("click", startExperience);

elements.next.addEventListener("click", nextRound);