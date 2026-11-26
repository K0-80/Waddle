import { GOOSE_SIZE, type Goose } from "./goose";

type SpriteName = "idle" | "quack" | "peck" | "surprise";

const spriteUrls: Record<SpriteName, string> = {
  idle: new URL("./assets/idle.png", import.meta.url).href,
  quack: new URL("./assets/quack.png", import.meta.url).href,
  peck: new URL("./assets/peck.png", import.meta.url).href,
  surprise: new URL("./assets/supprise.png", import.meta.url).href,
};

const spriteForState = (state: Goose["state"]): SpriteName => {
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
  private readonly images = new Map<SpriteName, HTMLImageElement>();
  private readonly alphaMasks = new Map<SpriteName, ImageData>();

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
              this.images.set(name, image);
              this.alphaMasks.set(
                name,
                scratchContext.getImageData(
                  0,
                  0,
                  image.naturalWidth,
                  image.naturalHeight,
                ),
              );
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
      const image = this.images.get(spriteName);
      if (!image) {
        continue;
      }

      const centerX = Math.round(goose.x + GOOSE_SIZE / 2);
      const centerY = Math.round(goose.y + GOOSE_SIZE / 2);
      this.context.save();
      this.context.translate(centerX, centerY);
      this.context.scale(goose.direction, 1);
      this.context.imageSmoothingEnabled = false;
      this.context.drawImage(
        image,
        -GOOSE_SIZE / 2,
        -GOOSE_SIZE / 2,
        GOOSE_SIZE,
        GOOSE_SIZE,
      );
      this.context.restore();
    }
  }

  containsPoint(goose: Goose, x: number, y: number): boolean {
    const spriteName = spriteForState(goose.state);
    const image = this.images.get(spriteName);
    const alphaMask = this.alphaMasks.get(spriteName);
    const localX = x - goose.x;
    const localY = y - goose.y;

    if (
      !image ||
      !alphaMask ||
      localX < 0 ||
      localX >= GOOSE_SIZE ||
      localY < 0 ||
      localY >= GOOSE_SIZE
    ) {
      return false;
    }

    let sourceX = Math.floor((localX / GOOSE_SIZE) * image.naturalWidth);
    const sourceY = Math.floor((localY / GOOSE_SIZE) * image.naturalHeight);
    if (goose.direction === -1) {
      sourceX = image.naturalWidth - 1 - sourceX;
    }

    return alphaMask.data[(sourceY * image.naturalWidth + sourceX) * 4 + 3] > 0;
  }
}
