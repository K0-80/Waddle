import {
  ANIMATION_FPS,
  GOOSE_SIZE,
  SPRITE_OFFSET_Y,
  type Goose,
} from "./goose";

type SpriteName =
  | "idle"
  | "walk"
  | "run"
  | "quack"
  | "peck"
  | "surprise";

interface SpriteSheet {
  image: HTMLImageElement;
  alphaMask: ImageData;
  frameCount: number;
  isHorizontal: boolean;
}

const FRAME_SIZE = 64;

const spriteUrls: Record<SpriteName, string> = {
  idle: new URL("./assets/sprites/idle.png", import.meta.url).href,
  walk: new URL("./assets/sprites/walk.png", import.meta.url).href,
  run: new URL("./assets/sprites/run.png", import.meta.url).href,
  quack: new URL("./assets/quack.png", import.meta.url).href,
  peck: new URL("./assets/peck.png", import.meta.url).href,
  surprise: new URL("./assets/supprise.png", import.meta.url).href,
};

const spriteForState = (state: Goose["state"]): SpriteName => {
  if (state === "wandering") {
    return "walk";
  }
  if (state === "attack") {
    return "run";
  }
  if (state === "quack") {
    return "quack";
  }
  if (state === "peck") {
    return "peck";
  }
  if (state === "surprise") {
    return "surprise";
  }
  return "idle";
};

export class GooseRenderer {
  private readonly sprites = new Map<SpriteName, SpriteSheet>();

  constructor(private readonly context: CanvasRenderingContext2D) {}

  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(spriteUrls) as SpriteName[]).map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              const scratch = document.createElement("canvas");
              scratch.width = image.naturalWidth;
              scratch.height = image.naturalHeight;
              const scratchContext = scratch.getContext("2d", {
                willReadFrequently: true,
              });
              if (!scratchContext) {
                reject(new Error(`Could not read the ${name} goose sprite.`));
                return;
              }

              scratchContext.drawImage(image, 0, 0);
              const isHorizontal =
                image.naturalWidth > image.naturalHeight;
              const frameCount = Math.floor(
                (isHorizontal ? image.naturalWidth : image.naturalHeight) /
                  FRAME_SIZE,
              );
              if (frameCount < 1) {
                reject(new Error(`The ${name} goose sprite has no full frames.`));
                return;
              }

              this.sprites.set(name, {
                image,
                alphaMask: scratchContext.getImageData(
                  0,
                  0,
                  image.naturalWidth,
                  image.naturalHeight,
                ),
                frameCount,
                isHorizontal,
              });
              resolve();
            };
            image.onerror = () =>
              reject(new Error(`Could not load the ${name} goose sprite.`));
            image.src = spriteUrls[name];
          }),
      ),
    );
  }

  draw(geese: Goose[]): void {
    for (const goose of geese) {
      const spriteName = spriteForState(goose.state);
      const sprite = this.sprites.get(spriteName);
      if (!sprite) {
        continue;
      }

      const frame = this.frameIndex(goose, sprite);
      const { x: sourceX, y: sourceY } = this.frameOffset(sprite, frame);
      const centerX = Math.round(goose.x + GOOSE_SIZE / 2);
      const centerY = Math.round(
        goose.y + SPRITE_OFFSET_Y + GOOSE_SIZE / 2,
      );
      this.context.save();
      this.context.translate(centerX, centerY);
      this.context.scale(goose.direction, 1);
      this.context.imageSmoothingEnabled = false;
      this.context.drawImage(
        sprite.image,
        sourceX,
        sourceY,
        FRAME_SIZE,
        FRAME_SIZE,
        -GOOSE_SIZE / 2,
        -GOOSE_SIZE / 2,
        GOOSE_SIZE,
        GOOSE_SIZE,
      );
      this.context.restore();
    }
  }

  containsPoint(goose: Goose, x: number, y: number): boolean {
    const sprite = this.sprites.get(spriteForState(goose.state));
    const localX = x - goose.x;
    const localY = y - goose.y - SPRITE_OFFSET_Y;

    if (
      !sprite ||
      localX < 0 ||
      localX >= GOOSE_SIZE ||
      localY < 0 ||
      localY >= GOOSE_SIZE
    ) {
      return false;
    }

    let frameX = Math.floor((localX / GOOSE_SIZE) * FRAME_SIZE);
    const frameY = Math.floor((localY / GOOSE_SIZE) * FRAME_SIZE);
    if (goose.direction === -1) {
      frameX = FRAME_SIZE - 1 - frameX;
    }

    for (let frame = 0; frame < sprite.frameCount; frame += 1) {
      const offset = this.frameOffset(sprite, frame);
      const sourceX = offset.x + frameX;
      const sourceY = offset.y + frameY;
      const alphaIndex =
        (sourceY * sprite.image.naturalWidth + sourceX) * 4 + 3;
      if (sprite.alphaMask.data[alphaIndex] > 0) {
        return true;
      }
    }

    return false;
  }

  private frameIndex(goose: Goose, sprite: SpriteSheet): number {
    return (
      Math.floor(goose.stateElapsed * ANIMATION_FPS) % sprite.frameCount
    );
  }

  private frameOffset(
    sprite: SpriteSheet,
    frame: number,
  ): { x: number; y: number } {
    return sprite.isHorizontal
      ? { x: frame * FRAME_SIZE, y: 0 }
      : { x: 0, y: frame * FRAME_SIZE };
  }
}
