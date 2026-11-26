import { GOOSE_SIZE, SPRITE_OFFSET_Y, type Goose } from "./goose";
import { SPRITE_ANIMATION_FPS } from "./settings";

type SpriteName =
  | "idle"
  | "walk"
  | "sprint"
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
const HITBOX_EXPANSION = 30;
const SOURCE_PIXEL_SIZE = GOOSE_SIZE / FRAME_SIZE;
const SOURCE_HITBOX_EXPANSION = Math.ceil(HITBOX_EXPANSION / SOURCE_PIXEL_SIZE);

const spriteUrls: Record<SpriteName, string> = {
  idle: new URL("./assets/sprites/idle.png", import.meta.url).href,
  walk: new URL("./assets/sprites/walk.png", import.meta.url).href,
  sprint: new URL("./assets/sprites/sprint.png", import.meta.url).href,
  quack: new URL("./assets/quack.png", import.meta.url).href,
  peck: new URL("./assets/peck.png", import.meta.url).href,
  surprise: new URL("./assets/supprise.png", import.meta.url).href,
};

const spriteForState = (state: Goose["state"]): SpriteName => {
  if (state === "wandering") {
    return "walk";
  }
  if (state === "attack") {
    return "sprint";
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

  draw(geese: Goose[], canvasWidth: number): void {
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
      this.drawNameTag(goose, canvasWidth);
    }
  }

  containsPoint(goose: Goose, x: number, y: number): boolean {
    const sprite = this.sprites.get(spriteForState(goose.state));
    const localX = x - goose.x;
    const localY = y - goose.y - SPRITE_OFFSET_Y;

    if (
      !sprite ||
      localX < -HITBOX_EXPANSION ||
      localX >= GOOSE_SIZE + HITBOX_EXPANSION ||
      localY < -HITBOX_EXPANSION ||
      localY >= GOOSE_SIZE + HITBOX_EXPANSION
    ) {
      return false;
    }

    let frameX = Math.floor((localX / GOOSE_SIZE) * FRAME_SIZE);
    const frameY = Math.floor((localY / GOOSE_SIZE) * FRAME_SIZE);
    if (goose.direction === -1) {
      frameX = FRAME_SIZE - 1 - frameX;
    }

    for (let yOffset = -SOURCE_HITBOX_EXPANSION; yOffset <= SOURCE_HITBOX_EXPANSION; yOffset += 1) {
      for (
        let xOffset = -SOURCE_HITBOX_EXPANSION;
        xOffset <= SOURCE_HITBOX_EXPANSION;
        xOffset += 1
      ) {
        const nearbyX = frameX + xOffset;
        const nearbyY = frameY + yOffset;
        if (
          nearbyX < 0 ||
          nearbyX >= FRAME_SIZE ||
          nearbyY < 0 ||
          nearbyY >= FRAME_SIZE
        ) {
          continue;
        }

        const displayedX =
          goose.direction === -1 ? FRAME_SIZE - 1 - nearbyX : nearbyX;
        const pixelLeft = displayedX * SOURCE_PIXEL_SIZE;
        const pixelTop = nearbyY * SOURCE_PIXEL_SIZE;
        const distanceX = Math.max(
          pixelLeft - localX,
          0,
          localX - pixelLeft - SOURCE_PIXEL_SIZE,
        );
        const distanceY = Math.max(
          pixelTop - localY,
          0,
          localY - pixelTop - SOURCE_PIXEL_SIZE,
        );
        if (distanceX > HITBOX_EXPANSION || distanceY > HITBOX_EXPANSION) {
          continue;
        }

        for (let frame = 0; frame < sprite.frameCount; frame += 1) {
          const offset = this.frameOffset(sprite, frame);
          const sourceX = offset.x + nearbyX;
          const sourceY = offset.y + nearbyY;
          const alphaIndex =
            (sourceY * sprite.image.naturalWidth + sourceX) * 4 + 3;
          if (sprite.alphaMask.data[alphaIndex] > 0) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private frameIndex(goose: Goose, sprite: SpriteSheet): number {
    return (
      Math.floor(goose.stateElapsed * SPRITE_ANIMATION_FPS) %
      sprite.frameCount
    );
  }

  private drawNameTag(goose: Goose, canvasWidth: number): void {
    const font = 'bold 16px "Minecraft", "Minecraftia", "Courier New", monospace';
    const paddingX = 7;
    const tagHeight = 24;
    this.context.save();
    this.context.font = font;
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    const tagWidth =
      Math.ceil(this.context.measureText(goose.name).width) + paddingX * 2;
    const x = Math.min(
      Math.max(0, Math.round(goose.x + GOOSE_SIZE / 2 - tagWidth / 2)),
      Math.max(0, canvasWidth - tagWidth),
    );
    const y = Math.max(
      0,
      Math.round(goose.y + SPRITE_OFFSET_Y - tagHeight - 4),
    );

    this.context.fillStyle = "rgba(54, 54, 54, 0.78)";
    this.context.fillRect(x, y, tagWidth, tagHeight);
    this.context.strokeStyle = "rgba(0, 0, 0, 0.55)";
    this.context.strokeRect(x + 0.5, y + 0.5, tagWidth - 1, tagHeight - 1);
    this.context.fillStyle = "#ffffff";
    this.context.fillText(
      goose.name,
      goose.x + GOOSE_SIZE / 2,
      y + tagHeight / 2,
    );
    this.context.restore();
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
