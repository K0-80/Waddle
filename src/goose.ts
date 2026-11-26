export const GOOSE_SIZE = 128;
export const MIN_GOOSE_DISTANCE = GOOSE_SIZE + 18;

export type GooseState =
  | "idle"
  | "wandering"
  | "quack"
  | "surprise"
  | "attack"
  | "peck";

const GRAVITY = 1500;
const randomBetween = (min: number, max: number): number =>
  min + Math.random() * (max - min);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export class Goose {
  x: number;
  y: number;
  direction: -1 | 1 = 1;
  state: GooseState = "idle";
  stateElapsed = 0;
  velocityY = 0;
  private stateDuration = randomBetween(0.8, 2.2);
  private speed = 0;
  private wanderTarget: number | null = null;
  private attackTarget: Goose | null = null;
  private surpriseAttacker: Goose | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  quack(): void {
    this.cancelAttack();
    this.wanderTarget = null;
    this.transition("quack", 0.85);
  }

  attack(target: Goose): void {
    this.attackTarget = target;
    this.wanderTarget = null;
    this.speed = randomBetween(300, 380);
    this.state = "attack";
    this.stateElapsed = 0;
    this.stateDuration = Number.POSITIVE_INFINITY;
  }

  prepareForAttack(attacker: Goose): void {
    this.wanderTarget = null;
    this.surpriseAttacker = attacker;
    this.direction = attacker.x < this.x ? -1 : 1;
    this.transition("surprise", Number.POSITIVE_INFINITY);
  }

  finishSurprise(): void {
    if (this.state === "surprise") {
      this.surpriseAttacker = null;
      this.returnToIdle();
    }
  }

  beginDrag(): void {
    if (this.state === "surprise") {
      const attacker = this.surpriseAttacker;
      this.surpriseAttacker = null;
      this.returnToIdle();
      attacker?.cancelAttack();
    } else {
      this.cancelAttack();
      this.returnToIdle();
    }

    this.velocityY = 0;
  }

  resize(maxX: number, maxY: number): void {
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
    if (this.wanderTarget !== null) {
      this.wanderTarget = clamp(this.wanderTarget, 0, maxX);
    }
  }

  update(deltaSeconds: number, maxX: number, floorY: number): boolean {
    this.stateElapsed += deltaSeconds;
    let attackLanded = false;

    switch (this.state) {
      case "idle":
        if (this.stateElapsed >= this.stateDuration) {
          this.startWandering(maxX);
        }
        break;
      case "wandering":
        this.moveToward(this.wanderTarget ?? this.x, deltaSeconds, maxX);
        if (
          this.stateElapsed >= this.stateDuration ||
          this.wanderTarget === null ||
          Math.abs(this.wanderTarget - this.x) < 1
        ) {
          this.returnToIdle();
        }
        break;
      case "attack":
        attackLanded = this.updateAttack(deltaSeconds, maxX);
        break;
      case "quack":
        if (this.stateElapsed >= this.stateDuration) {
          this.returnToIdle();
        }
        break;
      case "peck":
        if (this.stateElapsed >= this.stateDuration) {
          this.attackTarget?.finishSurprise();
          this.attackTarget = null;
          this.returnToIdle();
        }
        break;
      case "surprise":
        break;
    }

    this.velocityY += GRAVITY * deltaSeconds;
    this.y = Math.min(floorY, this.y + this.velocityY * deltaSeconds);
    if (this.y === floorY) {
      this.velocityY = 0;
    }

    return attackLanded;
  }

  constrainDistanceFrom(other: Goose, maxX: number): void {
    const distance = other.x - this.x;
    if (Math.abs(distance) >= MIN_GOOSE_DISTANCE) {
      return;
    }

    const direction = distance >= 0 ? 1 : -1;
    const correction = (MIN_GOOSE_DISTANCE - Math.abs(distance)) / 2;
    this.x = clamp(this.x - direction * correction, 0, maxX);
    other.x = clamp(other.x + direction * correction, 0, maxX);
  }

  private updateAttack(deltaSeconds: number, maxX: number): boolean {
    if (!this.attackTarget) {
      this.returnToIdle();
      return false;
    }

    const distance = this.attackTarget.x - this.x;
    this.direction = distance >= 0 ? 1 : -1;
    if (Math.abs(distance) <= MIN_GOOSE_DISTANCE) {
      this.wanderTarget = null;
      this.transition("peck", 0.55);
      return true;
    }

    this.moveToward(
      this.attackTarget.x - this.direction * MIN_GOOSE_DISTANCE,
      deltaSeconds,
      maxX,
    );
    return false;
  }

  private startWandering(maxX: number): void {
    const target = randomBetween(0, maxX);
    if (Math.abs(target - this.x) < 12) {
      this.returnToIdle();
      return;
    }

    this.wanderTarget = target;
    this.direction = target > this.x ? 1 : -1;
    this.speed = randomBetween(36, 84);
    this.state = "wandering";
    this.stateElapsed = 0;
    this.stateDuration = randomBetween(1.2, 3.4);
  }

  private moveToward(target: number, deltaSeconds: number, maxX: number): void {
    const distance = target - this.x;
    this.direction = distance >= 0 ? 1 : -1;
    this.x += this.direction * Math.min(Math.abs(distance), this.speed * deltaSeconds);
    this.x = clamp(this.x, 0, maxX);
  }

  private cancelAttack(): void {
    this.attackTarget?.finishSurprise();
    this.attackTarget = null;
  }

  private returnToIdle(): void {
    this.wanderTarget = null;
    this.transition("idle", randomBetween(0.8, 2.2));
  }

  private transition(state: GooseState, duration: number): void {
    this.state = state;
    this.stateElapsed = 0;
    this.stateDuration = duration;
    this.speed = 0;
  }
}
