import {
  GOOSE_RUN_SPEED,
  GOOSE_WALK_SPEED,
  SPRITE_ANIMATION_FPS,
} from "./settings";

export const GOOSE_SIZE = 128;
export const SPRITE_OFFSET_Y = 15;
const PREFERRED_GOOSE_DISTANCE = GOOSE_SIZE + 18;
const ATTACK_CONTACT_DISTANCE = GOOSE_SIZE - 48;

const IDLE_FRAME_COUNT = 6;
const WALK_FRAME_COUNT = 7;
const RUN_FRAME_COUNT = 8;
const IDLE_CYCLE_SECONDS = IDLE_FRAME_COUNT / SPRITE_ANIMATION_FPS;
const WALK_CYCLE_SECONDS = WALK_FRAME_COUNT / SPRITE_ANIMATION_FPS;
const RUN_CYCLE_SECONDS = RUN_FRAME_COUNT / SPRITE_ANIMATION_FPS;
const WALK_SPEED = GOOSE_WALK_SPEED;
const WALK_CYCLE_DISTANCE = WALK_SPEED * WALK_CYCLE_SECONDS;

export type GooseState =
  | "idle"
  | "wandering"
  | "quack"
  | "surprise"
  | "attack"
  | "peck";

const GRAVITY = 1500;
const CEILING_BOUNCE = 0.3;
const AIR_DRAG = 0.55;
const GROUND_DRAG = 5;
const BOUNDARY_BOUNCE = 0.35;
const MAX_THROW_SPEED = 1500;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const randomIdleDuration = (): number =>
  (7 + Math.floor(Math.random() * 7)) * IDLE_CYCLE_SECONDS;

export class Goose {
  x: number;
  y: number;
  direction: -1 | 1 = 1;
  state: GooseState = "idle";
  stateElapsed = 0;
  velocityX = 0;
  velocityY = 0;
  private stateDuration = randomIdleDuration();
  private speed = 0;
  private wanderTarget: number | null = null;
  private attackTarget: Goose | null = null;
  private surpriseAttacker: Goose | null = null;
  private avoidanceCooldown = 0;
  private attackContactAt: number | null = null;
  private nextAvoidanceAt = WALK_CYCLE_SECONDS;

  constructor(
    x: number,
    y: number,
    readonly name: string,
  ) {
    this.x = x;
    this.y = y;
  }

  quack(): void {
    this.cancelAttack();
    this.wanderTarget = null;
    this.transition("quack", 0.85);
  }

  attack(target: Goose): boolean {
    this.attackTarget = target;
    this.attackContactAt = null;
    this.wanderTarget = null;
    if (Math.abs(target.x - this.x) <= ATTACK_CONTACT_DISTANCE) {
      this.transition("peck", 0.55);
      return true;
    }

    this.speed = GOOSE_RUN_SPEED;
    this.state = "attack";
    this.stateElapsed = 0;
    this.stateDuration = Number.POSITIVE_INFINITY;
    return false;
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

    this.velocityX = 0;
    this.velocityY = 0;
  }

  releaseFromDrag(velocityX: number, velocityY: number): void {
    this.velocityX = clamp(velocityX, -MAX_THROW_SPEED, MAX_THROW_SPEED);
    this.velocityY = clamp(velocityY, -MAX_THROW_SPEED, MAX_THROW_SPEED);
  }

  resize(maxX: number, maxY: number): void {
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
    if (this.wanderTarget !== null) {
      this.wanderTarget = clamp(this.wanderTarget, 0, maxX);
    }
  }

  update(
    deltaSeconds: number,
    maxX: number,
    floorY: number,
    other: Goose,
  ): boolean {
    this.stateElapsed += deltaSeconds;
    this.avoidanceCooldown = Math.max(
      0,
      this.avoidanceCooldown - deltaSeconds,
    );
    let attackLanded = false;

    switch (this.state) {
      case "idle":
        if (this.stateElapsed >= this.stateDuration) {
          this.startWandering(maxX);
        }
        break;
      case "wandering":
        if (
          this.stateElapsed < this.stateDuration &&
          this.stateElapsed + 0.02 >= this.nextAvoidanceAt
        ) {
          this.nextAvoidanceAt += WALK_CYCLE_SECONDS;
          this.considerAvoidance(other, maxX);
        }
        this.moveToward(this.wanderTarget ?? this.x, deltaSeconds, maxX);
        if (
          this.stateElapsed >= this.stateDuration ||
          this.wanderTarget === null
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
    this.y += this.velocityY * deltaSeconds;
    if (this.y < 0) {
      this.y = 0;
      this.velocityY = Math.abs(this.velocityY) * CEILING_BOUNCE;
    } else if (this.y >= floorY) {
      this.y = floorY;
      this.velocityY = 0;
    }

    this.x += this.velocityX * deltaSeconds;
    if (this.x < 0) {
      this.x = 0;
      this.velocityX = Math.abs(this.velocityX) * BOUNDARY_BOUNCE;
    } else if (this.x > maxX) {
      this.x = maxX;
      this.velocityX = -Math.abs(this.velocityX) * BOUNDARY_BOUNCE;
    }

    const drag = this.y === floorY && this.velocityY === 0
      ? GROUND_DRAG
      : AIR_DRAG;
    this.velocityX *= Math.exp(-drag * deltaSeconds);
    if (Math.abs(this.velocityX) < 6) {
      this.velocityX = 0;
    }

    return attackLanded;
  }

  private considerAvoidance(other: Goose, maxX: number): void {
    const distance = Math.abs(other.x - this.x);
    if (
      this.avoidanceCooldown > 0 ||
      distance >= PREFERRED_GOOSE_DISTANCE
    ) {
      return;
    }

    const closeness = 1 - distance / PREFERRED_GOOSE_DISTANCE;
    const avoidanceProbability = 0.2 + closeness * 0.7;
    this.avoidanceCooldown = 0.45;

    if (Math.random() < avoidanceProbability) {
      this.wanderAwayFrom(other.x, maxX);
    }
  }

  private updateAttack(deltaSeconds: number, maxX: number): boolean {
    if (!this.attackTarget) {
      this.returnToIdle();
      return false;
    }

    const distance = this.attackTarget.x - this.x;
    this.direction = distance >= 0 ? 1 : -1;
    if (Math.abs(distance) <= ATTACK_CONTACT_DISTANCE) {
      this.wanderTarget = null;
      if (this.attackContactAt === null) {
        const completedCycles = Math.floor(
          (this.stateElapsed + 0.02) / RUN_CYCLE_SECONDS,
        );
        this.attackContactAt =
          Math.max(1, completedCycles) * RUN_CYCLE_SECONDS;
      }

      if (this.stateElapsed >= this.attackContactAt - 0.02) {
        this.attackContactAt = null;
        this.transition("peck", 0.55);
        return true;
      }
      return false;
    }

    this.attackContactAt = null;
    this.moveToward(
      this.attackTarget.x - this.direction * ATTACK_CONTACT_DISTANCE,
      deltaSeconds,
      maxX,
    );
    return false;
  }

  private startWandering(maxX: number): void {
    const screenWidth = maxX + GOOSE_SIZE;
    const desiredCycles = Math.max(
      1,
      Math.round(screenWidth / 3 / WALK_CYCLE_DISTANCE),
    );
    const desiredDistance = desiredCycles * WALK_CYCLE_DISTANCE;
    const availableDirections = ([-1, 1] as const).filter((direction) => {
      const available = direction < 0 ? this.x : maxX - this.x;
      return available >= desiredDistance;
    });
    const direction =
      availableDirections.length > 0
        ? availableDirections[
            Math.floor(Math.random() * availableDirections.length)
          ]
        : this.x >= maxX - this.x
          ? -1
          : 1;

    this.startWalking(direction, desiredCycles, maxX);
  }

  private wanderAwayFrom(otherX: number, maxX: number): void {
    const awayDirection: -1 | 1 =
      this.x < otherX
        ? -1
        : this.x > otherX
          ? 1
          : Math.random() < 0.5
            ? -1
            : 1;
    const desiredCycles = Math.max(
      1,
      Math.round((maxX + GOOSE_SIZE) / 3 / WALK_CYCLE_DISTANCE),
    );
    this.startWalking(awayDirection, desiredCycles, maxX);
  }

  private startWalking(
    direction: -1 | 1,
    desiredCycles: number,
    maxX: number,
  ): void {
    const available = direction < 0 ? this.x : maxX - this.x;
    const cycles = Math.min(
      desiredCycles,
      Math.floor(available / WALK_CYCLE_DISTANCE),
    );
    if (cycles < 1) {
      this.returnToIdle();
      return;
    }

    this.wanderTarget =
      this.x + direction * cycles * WALK_CYCLE_DISTANCE;
    this.direction = direction;
    this.speed = WALK_SPEED;
    this.stateElapsed = 0;
    this.stateDuration = cycles * WALK_CYCLE_SECONDS;
    this.nextAvoidanceAt = WALK_CYCLE_SECONDS;
    this.state = "wandering";
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
    this.attackContactAt = null;
  }

  private returnToIdle(): void {
    this.wanderTarget = null;
    this.transition("idle", randomIdleDuration());
  }

  private transition(state: GooseState, duration: number): void {
    this.state = state;
    this.stateElapsed = 0;
    this.stateDuration = duration;
    this.speed = 0;
  }
}
