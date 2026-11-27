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
  type RemoteProfile,
  type RoomSound,
  type RoomInfo,
} from "./multiplayer";
import {
  playAttackSound,
  playHonkSound,
  playSplatSound,
  startRunningSound,
  stopRunningSound,
  setMasterVolume,
  setMuteWhenUnfocused,
  unlockAudio,
} from "./quack-audio";
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from "./settings";
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
const connectionIndicator =
  requiredElement<HTMLElement>("#connection-indicator");
const sessionBar = requiredElement<HTMLElement>("#session-bar");
const sessionMenu = requiredElement<HTMLElement>("#session-menu");
const sessionName = requiredElement<HTMLElement>("#session-name");
const localConnectionStatus =
  requiredElement<HTMLElement>("#local-connection-status");
const localProfile = requiredElement<HTMLElement>("#local-profile");
const remoteProfileSection =
  requiredElement<HTMLElement>("#remote-profile");
const remoteAboutMe =
  requiredElement<HTMLElement>("#remote-about-me");
const localMenuContent =
  requiredElement<HTMLElement>("#local-menu-content");
const settingsContent =
  requiredElement<HTMLElement>("#settings-content");
const settingsButton =
  requiredElement<HTMLButtonElement>("#settings");
const exitMenuButton =
  requiredElement<HTMLButtonElement>("#exit-menu");
const settingsBackButton =
  requiredElement<HTMLButtonElement>("#settings-back");
const settingsStatus =
  requiredElement<HTMLElement>("#settings-status");
const roomSetup = requiredElement<HTMLElement>("#room-setup");
const roomDetails = requiredElement<HTMLElement>("#room-details");
const roomForm = requiredElement<HTMLFormElement>("#room-form");
const roomNameInput = requiredElement<HTMLInputElement>("#room-name");
const joinFlockButton =
  requiredElement<HTMLButtonElement>("#join-flock");
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

interface MenuTarget {
  goose: Goose;
  profile: RemoteProfile | null;
}

let playerGoose: Goose | null = null;
let playerUserId: string | null = null;
let activeAttackTargetId: string | null = null;
let multiplayer: Multiplayer | null = null;
let lastLocalImpactSequence = 0;
let userPreferences = { ...DEFAULT_USER_PREFERENCES };
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
let sessionMenuExpanded = false;
let menuTarget: MenuTarget | null = null;
let hoveredGoose: Goose | null = null;
let pointerPollErrorLogged = false;

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

function playOneShot(
  sound: "honk" | "attack" | "splat",
  broadcast = true,
): void {
  if (broadcast && sound !== "splat") {
    multiplayer?.broadcastSound(sound);
  }
  const playback =
    sound === "honk"
      ? playHonkSound()
      : sound === "attack"
        ? playAttackSound()
        : playSplatSound();
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
    multiplayer?.broadcastSound("running-start");
  } else {
    stopRunningSound();
    multiplayer?.broadcastSound("running-stop");
  }
}

function playRoomSound(userId: string, sound: RoomSound): void {
  if (sound === "running-start") {
    void startRunningSound(userId).catch((error: unknown) => {
      console.error("Could not play a remote running sound.", error);
    });
  } else if (sound === "running-stop") {
    stopRunningSound(userId);
  } else {
    playOneShot(sound, false);
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

  if (playerGoose && playerGoose.impactSequence > lastLocalImpactSequence) {
    while (lastLocalImpactSequence < playerGoose.impactSequence) {
      lastLocalImpactSequence += 1;
      playOneShot("splat");
    }
  }

  multiplayer?.update(playerGoose, deltaSeconds);
  syncRunningSound();
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  if (hoveredGoose && !geese.includes(hoveredGoose)) {
    hoveredGoose = null;
  }
  if (sessionMenuExpanded && menuTarget) {
    if (!geese.includes(menuTarget.goose)) {
      closeGooseMenu();
    } else {
      if (menuTarget.goose !== playerGoose) {
        menuTarget.profile =
          multiplayer?.getRemoteProfile(menuTarget.goose) ?? null;
        remoteAboutMe.textContent = menuTarget.profile?.aboutMe ?? "";
      }
      positionSessionMenu();
    }
  }
  const hiddenNameTagGoose = sessionMenuExpanded
    ? menuTarget?.goose ?? null
    : null;
  renderer.draw(
    geese,
    canvasWidth,
    hoveredGoose,
    userPreferences.alwaysShowNameTags,
    hiddenNameTagGoose,
  );
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
  const label =
    state === "online"
      ? "Online"
      : state === "connecting"
        ? "Connecting"
        : "Offline";
  connectionStatus.textContent =
    label;
  connectionIndicator.classList.remove("online", "connecting", "offline");
  connectionIndicator.classList.add(state);
  connectionIndicator.setAttribute("aria-label", label);
  connectionIndicator.setAttribute("title", label);
}

function applyUserPreferences(
  preferences: UserPreferences,
  forceAlwaysOnTop = false,
): void {
  const previousPreferences = userPreferences;
  const alwaysOnTopChanged =
    preferences.alwaysOnTop !== userPreferences.alwaysOnTop;
  userPreferences = preferences;
  if (preferences.volume !== previousPreferences.volume) {
    setMasterVolume(preferences.volume);
  }
  if (preferences.muteWhenUnfocused !== previousPreferences.muteWhenUnfocused) {
    setMuteWhenUnfocused(preferences.muteWhenUnfocused);
  }
  if (forceAlwaysOnTop || alwaysOnTopChanged) {
    void overlayWindow
      .setAlwaysOnTop(preferences.alwaysOnTop)
      .catch((error: unknown) => {
        const detail =
          error instanceof Error ? error.message : "Unknown window error.";
        settingsStatus.textContent =
          `Could not update always-on-top setting: ${detail}`;
        settingsStatus.classList.add("error");
        console.error("Could not update the always-on-top setting.", error);
      });
  }
}

function positionSessionMenu(): void {
  const goose = menuTarget?.goose;
  if (sessionMenu.hidden || !goose) {
    return;
  }
  const canvasBounds = petCanvas.getBoundingClientRect();
  const menuBounds = sessionMenu.getBoundingClientRect();
  const centerX = canvasBounds.left + goose.x + GOOSE_SIZE / 2;
  const gooseTop = canvasBounds.top + goose.y + SPRITE_OFFSET_Y;
  const gooseBottom = gooseTop + GOOSE_SIZE;
  const left = Math.min(
    Math.max(12, centerX - menuBounds.width / 2),
    Math.max(12, window.innerWidth - menuBounds.width - 12),
  );
  const aboveTop = gooseTop - menuBounds.height - 12;
  const belowTop = gooseBottom + 12;
  const top = Math.min(
    Math.max(12, aboveTop >= 12 ? aboveTop : belowTop),
    Math.max(12, window.innerHeight - menuBounds.height - 12),
  );
  sessionMenu.style.left = `${Math.round(left)}px`;
  sessionMenu.style.top = `${Math.round(top)}px`;
}

function setSessionMenuExpanded(
  expanded: boolean,
  target: MenuTarget | null = menuTarget,
): void {
  sessionMenuExpanded = expanded;
  if (expanded) {
    if (!playerGoose || !target) {
      return;
    }
    settingsContent.hidden = true;
    localMenuContent.hidden = false;
    menuTarget = target;
    const remote = target.goose !== playerGoose;
    if (remote) {
      playerGoose.setMenuOpen(false);
    } else {
      finishActiveAttack();
      playerGoose.setMenuOpen(true);
    }
    sessionName.textContent = remote
      ? target.profile?.username ?? target.goose.name
      : playerGoose.name;
    localConnectionStatus.hidden = remote;
    localProfile.hidden = remote;
    localMenuContent.hidden = remote;
    remoteProfileSection.hidden = !remote;
    if (remote) {
      remoteAboutMe.textContent = target.profile?.aboutMe ?? "";
    }
  } else {
    settingsContent.hidden = true;
    menuTarget = null;
    playerGoose?.setMenuOpen(false);
  }
  sessionMenu.hidden = !expanded;
  if (expanded) {
    positionSessionMenu();
  }
}

function setSettingsView(open: boolean): void {
  if (!sessionMenuExpanded || menuTarget?.goose !== playerGoose) {
    return;
  }
  localProfile.hidden = open;
  localMenuContent.hidden = open;
  settingsContent.hidden = !open;
  positionSessionMenu();
}

function openGooseMenu(goose: Goose): void {
  if (!playerGoose) {
    return;
  }
  const profile =
    goose === playerGoose
      ? null
      : multiplayer?.getRemoteProfile(goose) ?? null;
  setSessionMenuExpanded(true, { goose, profile });
}

function closeGooseMenu(): void {
  if (sessionMenuExpanded) {
    setSessionMenuExpanded(false);
  }
}

function updateRoomTimer(): void {
  if (!currentRoomInfo) {
    return;
  }
  const elapsedSeconds = Math.floor(
    Math.max(0, Date.now() - currentRoomInfo.roomStartedAt) / 1000,
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
  const justLeft = currentRoomInfo !== null && info === null;
  currentRoomInfo = info;
  roomSetup.hidden = info !== null;
  roomDetails.hidden = info === null;

  if (!info) {
    if (justLeft && playerGoose) {
      openGooseMenu(playerGoose);
    }
    roomCodeElement.textContent = "";
    roomPlayerCountElement.textContent = "";
    roomOnlineTimeElement.textContent = "00:00";
    if (roomTimer !== null) {
      window.clearInterval(roomTimer);
      roomTimer = null;
    }
    return;
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
  joinFlockButton.disabled = disabled;
}

async function enterRoom(): Promise<void> {
  const activeMultiplayer = multiplayer;
  if (!activeMultiplayer) {
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
    await activeMultiplayer.joinRoom(roomCode);
  } catch (error) {
    roomFeedback.textContent =
      error instanceof Error
        ? error.message
        : "Could not enter that room. Please try again.";
  } finally {
    setRoomButtonsDisabled(false);
  }
}

function startMultiplayer(user: { username: string; aboutMe: string }): void {
  if (!playerGoose) {
    return;
  }

  multiplayer = new Multiplayer(user, {
    onConnectionChange: setConnectionStatus,
    onRoomInfoChange: renderRoomInfo,
    onImpactSound: () => playOneShot("splat"),
    onRoomSound: playRoomSound,
    onError: (message) => {
      roomFeedback.textContent = message;
    },
  });
  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const maxY = Math.max(0, canvasHeight - GOOSE_SIZE);
  multiplayer.setLocalGoose(playerGoose, maxX, maxY);
  roomSetup.hidden = false;
  roomDetails.hidden = true;
  roomFeedback.textContent = "";
  setConnectionStatus("offline");
}

function handleAuthenticated(
  _client: SupabaseClient,
  user: {
    id: string;
    username: string;
    aboutMe: string;
    preferences: UserPreferences;
  },
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
  applyUserPreferences(user.preferences, true);
  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  playerGoose = new Goose(
    getDeterministicSpawnX(user.id, maxX),
    Math.max(0, canvasHeight - GOOSE_SIZE),
    user.username,
  );
  lastLocalImpactSequence = playerGoose.impactSequence;
  resizeCanvas();
  startAnimation();
  startMultiplayer(user);
  sessionBar.hidden = false;
  settingsContent.hidden = true;
  localMenuContent.hidden = false;
  openGooseMenu(playerGoose);
  void setCursorEventsIgnored(false);
}

function handleSignedOut(): void {
  closeGooseMenu();
  finishActiveAttack();
  pointerGesture = null;
  playerGoose = null;
  lastLocalImpactSequence = 0;
  playerUserId = null;
  settingsContent.hidden = true;
  localMenuContent.hidden = false;
  applyUserPreferences(
    { ...DEFAULT_USER_PREFERENCES, alwaysOnTop: false },
    true,
  );
  roomFeedback.textContent = "";
  renderRoomInfo(null);
  setSessionMenuExpanded(false);
  hoveredGoose = null;
  stopRunningSound();
  runningSoundActive = false;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  setConnectionStatus("offline");
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
    const gooseUnderPointer = pointerOnUi
      ? undefined
      : findGooseAt(localX, localY);
    hoveredGoose = gooseUnderPointer ?? null;
    const shouldIgnoreCursorEvents =
      pointerGesture === null &&
      !gooseUnderPointer &&
      !pointerOnUi;

    await setCursorEventsIgnored(shouldIgnoreCursorEvents);
    pointerPollErrorLogged = false;
  } catch (error) {
    if (!pointerPollErrorLogged) {
      console.error(
        "Goose hit testing failed. Restoring normal window pointer handling.",
        error,
      );
      pointerPollErrorLogged = true;
    }
    await setCursorEventsIgnored(false);
  } finally {
    window.setTimeout(() => {
      void pollPointer();
    }, POINTER_POLL_INTERVAL_MS);
  }
}

async function startPointerTracking(): Promise<void> {
  try {
    await Promise.all([
      overlayWindow.onMoved(({ payload }) => {
        windowPosition = payload;
      }),
      overlayWindow.onScaleChanged(({ payload }) => {
        windowScaleFactor = payload.scaleFactor;
        resizeCanvas();
        positionSessionMenu();
      }),
    ]);
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
  if (!playerGoose) {
    return;
  }

  const pointer = pointerPositionInCanvas(event);
  const goose = findGooseAt(pointer.x, pointer.y);
  if (!goose) {
    return;
  }
  if (event.button === 2) {
    event.preventDefault();
    if (sessionMenuExpanded && menuTarget?.goose === goose) {
      closeGooseMenu();
    } else {
      openGooseMenu(goose);
    }
    void setCursorEventsIgnored(false);
    return;
  }
  if (pointerGesture || event.button !== 0) {
    return;
  }
  hoveredGoose = goose;

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
    if (sessionMenuExpanded) {
      closeGooseMenu();
    }
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGooseMenu();
  }
});
settingsButton.addEventListener("click", () => {
  setSettingsView(true);
});
settingsBackButton.addEventListener("click", () => {
  setSettingsView(false);
});
exitMenuButton.addEventListener("click", () => {
  void overlayWindow.close().catch((error: unknown) => {
    roomFeedback.textContent =
      error instanceof Error ? `Could not exit: ${error.message}` : "Could not exit Waddle.";
    console.error("Could not close the Waddle window.", error);
  });
});
roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void enterRoom();
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
  await document.fonts.load('16px "Monocraft"');
  await renderer.load();
  window.addEventListener("resize", () => {
    resizeCanvas();
    positionSessionMenu();
  });
  resizeCanvas();
  startAuthUi({
    onAuthenticated: handleAuthenticated,
    onSettingsChange: applyUserPreferences,
    onAboutMeChange: (aboutMe) => {
      multiplayer?.updateAboutMe(aboutMe);
    },
    onSignedOut: handleSignedOut,
  });
  void startPointerTracking();
}

void initialize().catch((error: unknown) => {
  console.error("Could not initialize the goose overlay.", error);
});
