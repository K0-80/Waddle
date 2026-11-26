import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import {
  Goose,
  GOOSE_SIZE,
  MIN_GOOSE_DISTANCE,
} from "./goose";
import { GooseRenderer } from "./goose-renderer";
import { playSoundEffect } from "./quack-audio";

const POINTER_POLL_INTERVAL_MS = 30;
const DRAG_THRESHOLD = 5;
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
const playerGoose = new Goose(0, 0);
const otherGoose = new Goose(0, 0);
const geese = [playerGoose, otherGoose];
const renderer = new GooseRenderer(context);

interface PointerGesture {
  goose: Goose;
  pointerId: number;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
}

let canvasWidth = 0;
let canvasHeight = 0;
let lastFrameTime = performance.now();
let cursorEventsIgnored = false;
let windowPosition = { x: 0, y: 0 };
let windowScaleFactor = 1;
let pointerGesture: PointerGesture | null = null;

function resizeCanvas(): void {
  const bounds = petCanvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const wasFirstSize = canvasWidth === 0;

  canvasWidth = bounds.width;
  canvasHeight = bounds.height;
  petCanvas.width = Math.round(canvasWidth * pixelRatio);
  petCanvas.height = Math.round(canvasHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = false;

  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const maxY = Math.max(0, canvasHeight - GOOSE_SIZE);
  geese.forEach((goose, index) => {
    if (wasFirstSize) {
      goose.x = maxX * (index === 0 ? 0.2 : 0.72);
      goose.y = maxY;
    } else {
      goose.resize(maxX, maxY);
    }
  });
}

function pointerPositionInCanvas(event: PointerEvent): { x: number; y: number } {
  const bounds = petCanvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function findGooseAt(x: number, y: number): Goose | undefined {
  return [...geese].reverse().find((goose) =>
    renderer.containsPoint(goose, x, y),
  );
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

function playEffect(effect: "quack" | "surprised" | "attacked"): void {
  void playSoundEffect(effect).catch((error: unknown) => {
    console.error(`Could not play the ${effect} sound effect.`, error);
  });
}

function handleGooseClick(goose: Goose): void {
  if (goose === playerGoose) {
    playerGoose.quack();
    playEffect("quack");
    return;
  }

  playerGoose.attack(otherGoose);
  otherGoose.prepareForAttack(playerGoose);
  playEffect("surprised");
}

function animate(now: number): void {
  const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const floorY = Math.max(0, canvasHeight - GOOSE_SIZE);

  for (const goose of geese) {
    if (pointerGesture?.goose !== goose) {
      const attackLanded = goose.update(deltaSeconds, maxX, floorY);
      if (attackLanded && goose === playerGoose) {
        playEffect("attacked");
      }
    }
  }

  const statesAllowSpacing = geese.every(
    (goose) => goose.state === "idle" || goose.state === "wandering",
  );
  if (!pointerGesture && statesAllowSpacing && maxX >= MIN_GOOSE_DISTANCE) {
    playerGoose.constrainDistanceFrom(otherGoose, maxX);
  }

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  renderer.draw(geese);
  requestAnimationFrame(animate);
}

async function pollPointer(): Promise<void> {
  try {
    const cursor = await cursorPosition();
    const localX = (cursor.x - windowPosition.x) / windowScaleFactor;
    const localY = (cursor.y - windowPosition.y) / windowScaleFactor;
    const shouldIgnoreCursorEvents =
      pointerGesture === null && !findGooseAt(localX, localY);

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
    await setCursorEventsIgnored(true);
    await pollPointer();
  } catch (error) {
    console.error(
      "Could not enable selective click-through. The overlay will remain interactive.",
      error,
    );
  }
}

petCanvas.addEventListener("pointerdown", (event) => {
  if (pointerGesture) {
    return;
  }

  const pointer = pointerPositionInCanvas(event);
  const goose = findGooseAt(pointer.x, pointer.y);
  if (!goose) {
    return;
  }

  pointerGesture = {
    goose,
    pointerId: event.pointerId,
    startX: pointer.x,
    startY: pointer.y,
    grabOffsetX: pointer.x - goose.x,
    grabOffsetY: pointer.y - goose.y,
    moved: false,
  };
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
  if (
    !gesture.moved &&
    Math.hypot(pointer.x - gesture.startX, pointer.y - gesture.startY) >=
      DRAG_THRESHOLD
  ) {
    gesture.moved = true;
    gesture.goose.beginDrag();
  }
  if (!gesture.moved) {
    return;
  }

  const maxX = Math.max(0, canvasWidth - GOOSE_SIZE);
  const maxY = Math.max(0, canvasHeight - GOOSE_SIZE);
  gesture.goose.x = Math.min(
    Math.max(0, pointer.x - gesture.grabOffsetX),
    maxX,
  );
  gesture.goose.y = Math.min(
    Math.max(0, pointer.y - gesture.grabOffsetY),
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
  if (!gesture.moved && !cancelled) {
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

async function initialize(): Promise<void> {
  await renderer.load();
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  requestAnimationFrame(animate);
  void startPointerTracking();
}

void initialize().catch((error: unknown) => {
  console.error("Could not initialize the goose overlay.", error);
});
