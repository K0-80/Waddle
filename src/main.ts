import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { startAuthUi } from "./auth-ui";
import {
  getDeterministicSpawnX,
  Goose,
  GOOSE_SIZE,
  SPRITE_OFFSET_Y,
} from "./goose";
import { GooseRenderer } from "./goose-renderer";
import {
  Multiplayer,
  normalizeRoomCode,
  type ConnectionState,
  type RoomInfo,
} from "./multiplayer";
import {
  playAttackSound,
  playHonkSound,
  startRunningSound,
  stopRunningSound,
  unlockAudio,
} from "./quack-audio";
import type { SupabaseClient } from "@supabase/supabase-js";

const POINTER_POLL_INTERVAL_MS = 30;
const DRAG_THRESHOLD = 5;

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`The multiplayer UI is missing ${selector}.`);
  }
  return element;
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#pet-canvas");

if (!canvasElement) {
  throw new Error("The pet canvas could not be found.");
}

const petCanvas: HTMLCanvasElement = canvasElement;
const canvasContext = petCanvas.getContext("2d");

if (!canvasContext) {
  throw new Error("A 2D canvas context is not available.");
}

const context: CanvasRenderingContext2D = canvasContext;
const overlayWindow = getCurrentWindow();
const renderer = new GooseRenderer(context);
const connectionStatusElement =
  document.querySelector<HTMLElement>("#connection-status");

if (!connectionStatusElement) {
  throw new Error("The multiplayer connection status could not be found.");
}
const connectionStatus: HTMLElement = connectionStatusElement;
const roomPanel = requiredElement<HTMLElement>("#room-panel");
const toggleRoomPanelButton =
  requiredElement<HTMLButtonElement>("#toggle-room-panel");
const roomSetup = requiredElement<HTMLElement>("#room-setup");
const roomDetails = requiredElement<HTMLElement>("#room-details");
const roomForm = requiredElement<HTMLFormElement>("#room-form");
const roomNameInput = requiredElement<HTMLInputElement>("#room-name");
const createRoomButton =
  requiredElement<HTMLButtonElement>("#create-room");
const joinRoomButton =
  requiredElement<HTMLButtonElement>("#join-room");
const leaveRoomButton =
  requiredElement<HTMLButtonElement>("#leave-room");
const roomFeedback = requiredElement<HTMLElement>("#room-feedback");
const roomCodeElement = requiredElement<HTMLElement>("#room-code");
const roomPlayerCountElement =
  requiredElement<HTMLElement>("#room-player-count");
const roomOnlineTimeElement =
  requiredElement<HTMLElement>("#room-online-time");

interface PointerGesture {
  goose: Goose;
  draggable: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
  samples: Array<{ x: number; y: number; time: number }>;
}

let playerGoose: Goose | null = null;
let playerUserId: string | null = null;
let activeAttackTargetId: string | null = null;
let multiplayer: Multiplayer | null = null;
let canvasWidth = 0;
let canvasHeight = 0;
let lastFrameTime = performance.now();
let cursorEventsIgnored = false;
let windowPosition = { x: 0, y: 0 };
let windowScaleFactor = 1;
let pointerGesture: PointerGesture | null = null;
let runningSoundActive = false;
let animationActive = false;
let currentRoomInfo: RoomInfo | null = null;
let roomTimer: number | null = null;
let roomPanelExpanded = true;

window.addEventListener("pointerdown", unlockAudio, {
  capture: true,
});
window.addEventListener("keydown", unlockAudio, {
  capture: true,
});
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

function getVisibleGeese(): Goose[] {
  return playerGoose
    ? [playerGoose, ...(multiplayer?.getRemoteGeese() ?? [])]
    : [];
}

function resizeCanvas(): void {
  const bounds = petCanvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;

  canvasWidth = bounds.width;
  canvasHeight = bounds.height;
  petCanvas.width = Math.round(canvasWidth * pixelRatio);
  petCanvas.height = Math.round(canvasHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = false;

  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const maxY = Math.max(0, canvasHeight - GOOSE_SIZE);
  playerGoose?.resize(maxX, maxY);
  multiplayer?.resize(maxX, maxY);
}

function pointerPositionInCanvas(event: PointerEvent): { x: number; y: number } {
  const bounds = petCanvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function findGooseAt(x: number, y: number): Goose | undefined {
  if (
    playerGoose &&
    renderer.containsPoint(playerGoose, x, y)
  ) {
    return playerGoose;
  }
  return (multiplayer?.getRemoteGeese() ?? [])
    .reverse()
    .find((goose) => renderer.containsPoint(goose, x, y));
}

function addPointerSample(
  gesture: PointerGesture,
  position: { x: number; y: number },
): void {
  const time = performance.now();
  gesture.samples.push({ ...position, time });
  const cutoff = time - 120;
  while (gesture.samples.length > 2 && gesture.samples[1].time < cutoff) {
    gesture.samples.shift();
  }
}

function getThrowVelocity(
  gesture: PointerGesture,
  position: { x: number; y: number },
): { x: number; y: number } {
  addPointerSample(gesture, position);
  const last = gesture.samples[gesture.samples.length - 1];
  const first =
    gesture.samples.find(
      (sample) =>
        sample.time >= last.time - 120 && last.time - sample.time >= 30,
    ) ??
    gesture.samples.find(
      (sample) =>
        sample.time >= last.time - 120 && last.time - sample.time >= 8,
    ) ??
    last;
  const elapsedSeconds = (last.time - first.time) / 1000;
  if (elapsedSeconds === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: (last.x - first.x) / elapsedSeconds,
    y: (last.y - first.y) / elapsedSeconds,
  };
}

async function setCursorEventsIgnored(ignore: boolean): Promise<void> {
  if (ignore === cursorEventsIgnored) {
    return;
  }

  try {
    await overlayWindow.setIgnoreCursorEvents(ignore);
    cursorEventsIgnored = ignore;
  } catch (error) {
    console.error("Could not update overlay pointer handling.", error);
  }
}

function playOneShot(sound: "honk" | "attack"): void {
  const playback = sound === "honk" ? playHonkSound() : playAttackSound();
  void playback.catch((error: unknown) => {
    console.error(`Could not play the ${sound} sound.`, error);
  });
}

function syncRunningSound(): void {
  const shouldRun = playerGoose?.state === "attack";
  if (shouldRun === runningSoundActive) {
    return;
  }

  runningSoundActive = shouldRun;
  if (shouldRun) {
    void startRunningSound().catch((error: unknown) => {
      console.error("Could not play the running sound.", error);
    });
  } else {
    stopRunningSound();
  }
}

function finishActiveAttack(): void {
  const targetUserId = activeAttackTargetId;
  activeAttackTargetId = null;
  if (targetUserId) {
    multiplayer?.finishAttack(targetUserId);
  }
}

function handleGooseClick(goose: Goose): void {
  if (!playerGoose) {
    return;
  }

  if (goose === playerGoose) {
    finishActiveAttack();
    goose.quack();
    playOneShot("honk");
    syncRunningSound();
    return;
  }

  if (playerGoose.state === "attack" || playerGoose.state === "peck") {
    return;
  }

  const targetUserId = multiplayer?.getUserId(goose);
  if (!targetUserId || !multiplayer?.requestAttack(targetUserId)) {
    return;
  }

  activeAttackTargetId = targetUserId;
  if (playerGoose.attack(goose)) {
    playOneShot("attack");
    finishActiveAttack();
  }
  syncRunningSound();
}

function animate(now: number): void {
  if (!playerGoose) {
    animationActive = false;
    return;
  }

  const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const floorY = Math.max(0, canvasHeight - GOOSE_SIZE);
  const geese = getVisibleGeese();

  for (const goose of geese) {
    if (goose === playerGoose && pointerGesture?.goose !== goose) {
      const wasAttacking = goose.state === "attack";
      const attackLanded = goose.update(deltaSeconds, maxX, floorY);
      if (attackLanded) {
        playOneShot("attack");
        finishActiveAttack();
      } else if (wasAttacking && goose.state !== "attack") {
        finishActiveAttack();
      }
    }
  }

  multiplayer?.update(playerGoose, deltaSeconds);
  syncRunningSound();
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  renderer.draw(geese, canvasWidth);
  requestAnimationFrame(animate);
}

function startAnimation(): void {
  if (animationActive) {
    return;
  }
  animationActive = true;
  lastFrameTime = performance.now();
  requestAnimationFrame(animate);
}

function setConnectionStatus(state: ConnectionState): void {
  connectionStatus.textContent =
    state === "online"
      ? "Online"
      : state === "connecting"
        ? "Connecting…"
        : "Offline";
  connectionStatus.classList.toggle("online", state === "online");
  connectionStatus.classList.toggle("connecting", state === "connecting");
}

function setRoomPanelExpanded(expanded: boolean): void {
  roomPanelExpanded = expanded;
  roomPanel.hidden = !expanded;
  toggleRoomPanelButton.setAttribute("aria-expanded", String(expanded));
  toggleRoomPanelButton.textContent = expanded ? "Hide flock" : "Show flock";
}

function updateRoomTimer(): void {
  if (!currentRoomInfo) {
    return;
  }
  const elapsedSeconds = Math.floor(
    Math.max(0, performance.now() - currentRoomInfo.joinedAt) / 1000,
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  roomOnlineTimeElement.textContent =
    hours > 0
      ? `${hours}:${String(remainingMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderRoomInfo(info: RoomInfo | null): void {
  const justJoined = currentRoomInfo === null && info !== null;
  currentRoomInfo = info;
  roomSetup.hidden = info !== null;
  roomDetails.hidden = info === null;

  if (!info) {
    setRoomPanelExpanded(true);
    roomCodeElement.textContent = "";
    roomPlayerCountElement.textContent = "";
    roomOnlineTimeElement.textContent = "00:00";
    if (roomTimer !== null) {
      window.clearInterval(roomTimer);
      roomTimer = null;
    }
    return;
  }

  if (justJoined) {
    setRoomPanelExpanded(false);
  }
  roomCodeElement.textContent = info.roomCode;
  roomPlayerCountElement.textContent =
    `${info.playerCount} / ${info.maxPlayers}`;
  updateRoomTimer();
  if (roomTimer === null) {
    roomTimer = window.setInterval(updateRoomTimer, 1000);
  }
}

function setRoomButtonsDisabled(disabled: boolean): void {
  roomNameInput.disabled = disabled;
  createRoomButton.disabled = disabled;
  joinRoomButton.disabled = disabled;
}

async function enterRoom(mode: "create" | "join"): Promise<void> {
  if (!multiplayer) {
    return;
  }

  let roomCode: string;
  try {
    roomCode = normalizeRoomCode(roomNameInput.value);
  } catch (error) {
    roomFeedback.textContent =
      error instanceof Error ? error.message : "Enter a valid room name.";
    return;
  }

  roomNameInput.value = roomCode;
  roomFeedback.textContent = "";
  setRoomButtonsDisabled(true);
  try {
    if (mode === "create") {
      await multiplayer.createRoom(roomCode);
    } else {
      await multiplayer.joinRoom(roomCode);
    }
  } catch (error) {
    roomFeedback.textContent =
      error instanceof Error
        ? error.message
        : "Could not enter that room. Please try again.";
  } finally {
    setRoomButtonsDisabled(false);
  }
}

function startMultiplayer(user: { username: string }): void {
  if (!playerGoose) {
    return;
  }

  multiplayer = new Multiplayer(user, {
    onConnectionChange: setConnectionStatus,
    onRoomInfoChange: renderRoomInfo,
    onError: (message) => {
      roomFeedback.textContent = message;
    },
  });
  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const maxY = Math.max(0, canvasHeight - GOOSE_SIZE);
  multiplayer.setLocalGoose(playerGoose, maxX, maxY);
  setRoomPanelExpanded(true);
  roomSetup.hidden = false;
  roomDetails.hidden = true;
  roomFeedback.textContent = "";
  setConnectionStatus("offline");
}

function handleAuthenticated(
  _client: SupabaseClient,
  user: { id: string; username: string },
): void {
  if (playerUserId === user.id) {
    return;
  }

  const activeMultiplayer = multiplayer;
  multiplayer = null;
  if (activeMultiplayer) {
    void activeMultiplayer.disconnect().catch((error: unknown) => {
      console.error("Could not replace the multiplayer session.", error);
    });
  }
  playerUserId = user.id;
  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  playerGoose = new Goose(
    getDeterministicSpawnX(user.id, maxX),
    Math.max(0, canvasHeight - GOOSE_SIZE),
    user.username,
  );
  resizeCanvas();
  startAnimation();
  startMultiplayer(user);
  void overlayWindow.setAlwaysOnTop(true).catch((error: unknown) => {
    console.error("Could not keep the signed-in goose window on top.", error);
  });
  void setCursorEventsIgnored(false);
}

function handleSignedOut(): void {
  finishActiveAttack();
  pointerGesture = null;
  playerGoose = null;
  playerUserId = null;
  roomFeedback.textContent = "";
  renderRoomInfo(null);
  roomPanel.hidden = true;
  stopRunningSound();
  runningSoundActive = false;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  setConnectionStatus("offline");
  void overlayWindow.setAlwaysOnTop(false).catch((error: unknown) => {
    console.error("Could not lower the signed-out Waddle window.", error);
  });
  void setCursorEventsIgnored(false);
  const activeMultiplayer = multiplayer;
  multiplayer = null;
  if (activeMultiplayer) {
    void activeMultiplayer.disconnect().catch((error: unknown) => {
      console.error("Could not disconnect multiplayer.", error);
    });
  }
}

async function pollPointer(): Promise<void> {
  try {
    const cursor = await cursorPosition();
    const localX = (cursor.x - windowPosition.x) / windowScaleFactor;
    const localY = (cursor.y - windowPosition.y) / windowScaleFactor;
    const elementUnderPointer = document.elementFromPoint(localX, localY);
    const pointerOnUi = Boolean(elementUnderPointer?.closest(".interactive"));
    const shouldIgnoreCursorEvents =
      pointerGesture === null &&
      !findGooseAt(localX, localY) &&
      !pointerOnUi;

    await setCursorEventsIgnored(shouldIgnoreCursorEvents);
    window.setTimeout(() => {
      void pollPointer();
    }, POINTER_POLL_INTERVAL_MS);
  } catch (error) {
    console.error(
      "Goose hit testing failed. Restoring normal window pointer handling.",
      error,
    );
    await setCursorEventsIgnored(false);
  }
}

async function startPointerTracking(): Promise<void> {
  try {
    const [position, scaleFactor] = await Promise.all([
      overlayWindow.outerPosition(),
      overlayWindow.scaleFactor(),
    ]);
    windowPosition = position;
    windowScaleFactor = scaleFactor;
    await pollPointer();
  } catch (error) {
    console.error(
      "Could not enable selective click-through. The overlay will remain interactive.",
      error,
    );
  }
}

petCanvas.addEventListener("pointerdown", (event) => {
  if (pointerGesture || !playerGoose || event.button !== 0) {
    return;
  }

  const pointer = pointerPositionInCanvas(event);
  const goose = findGooseAt(pointer.x, pointer.y);
  if (!goose) {
    return;
  }

  pointerGesture = {
    goose,
    draggable: goose === playerGoose,
    pointerId: event.pointerId,
    startX: pointer.x,
    startY: pointer.y,
    grabOffsetX: pointer.x - goose.x,
    grabOffsetY: pointer.y - goose.y - SPRITE_OFFSET_Y,
    moved: false,
    samples: [],
  };
  addPointerSample(pointerGesture, pointer);
  petCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
  void setCursorEventsIgnored(false);
});

petCanvas.addEventListener("pointermove", (event) => {
  const gesture = pointerGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) {
    return;
  }

  const pointer = pointerPositionInCanvas(event);
  addPointerSample(gesture, pointer);
  if (
    !gesture.moved &&
    Math.hypot(pointer.x - gesture.startX, pointer.y - gesture.startY) >=
      DRAG_THRESHOLD
  ) {
    gesture.moved = true;
    if (gesture.draggable) {
      if (gesture.goose === playerGoose && gesture.goose.state === "attack") {
        finishActiveAttack();
      }
      gesture.goose.beginDrag();
    } else {
      return;
    }
  }
  if (!gesture.moved || !gesture.draggable) {
    return;
  }

  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const maxY = Math.max(0, canvasHeight - GOOSE_SIZE);
  gesture.goose.x = Math.min(
    Math.max(0, pointer.x - gesture.grabOffsetX),
    maxX,
  );
  gesture.goose.y = Math.min(
    Math.max(0, pointer.y - gesture.grabOffsetY - SPRITE_OFFSET_Y),
    maxY,
  );
  gesture.goose.velocityY = 0;
});

function finishPointerGesture(event: PointerEvent, cancelled: boolean): void {
  const gesture = pointerGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) {
    return;
  }

  pointerGesture = null;
  if (gesture.moved) {
    if (gesture.draggable) {
      const pointer = pointerPositionInCanvas(event);
      const velocity = cancelled
        ? { x: 0, y: 0 }
        : getThrowVelocity(gesture, pointer);
      gesture.goose.releaseFromDrag(velocity.x, velocity.y);
    }
  } else if (!cancelled) {
    handleGooseClick(gesture.goose);
  }
  if (petCanvas.hasPointerCapture(event.pointerId)) {
    petCanvas.releasePointerCapture(event.pointerId);
  }
}

petCanvas.addEventListener("pointerup", (event) => {
  finishPointerGesture(event, false);
});
petCanvas.addEventListener("pointercancel", (event) => {
  finishPointerGesture(event, true);
});
petCanvas.addEventListener("lostpointercapture", (event) => {
  finishPointerGesture(event, true);
});

createRoomButton.addEventListener("click", () => {
  void enterRoom("create");
});
toggleRoomPanelButton.addEventListener("click", () => {
  setRoomPanelExpanded(!roomPanelExpanded);
});
roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void enterRoom("join");
});
leaveRoomButton.addEventListener("click", () => {
  const activeMultiplayer = multiplayer;
  if (!activeMultiplayer) {
    return;
  }
  roomFeedback.textContent = "";
  setRoomButtonsDisabled(true);
  leaveRoomButton.disabled = true;
  void activeMultiplayer
    .leaveRoom()
    .catch((error: unknown) => {
      console.error("Could not leave the multiplayer room.", error);
      roomFeedback.textContent = "Could not leave the room cleanly.";
    })
    .finally(() => {
      setRoomButtonsDisabled(false);
      leaveRoomButton.disabled = false;
    });
});

async function initialize(): Promise<void> {
  await document.fonts.load('bold 16px "Monocraft"');
  await renderer.load();
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  startAuthUi({
    onAuthenticated: handleAuthenticated,
    onSignedOut: handleSignedOut,
  });
  void startPointerTracking();
}

void initialize().catch((error: unknown) => {
  console.error("Could not initialize the goose overlay.", error);
});
