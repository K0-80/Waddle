import {
  GOOSE_RUN_SPEED,
  GOOSE_WALK_SPEED,
  SPRITE_ANIMATION_FPS,
} from "./settings";

export const GOOSE_SIZE = 128;
export const SPRITE_OFFSET_Y = 15;
const preferredGooseDistance = (): number => GOOSE_SIZE + 18;
const attackContactDistance = (): number => Math.round((GOOSE_SIZE * 5) / 8);
const ATTACK_TIMEOUT_SECONDS = 7;
const SURPRISE_DURATION_SECONDS = ATTACK_TIMEOUT_SECONDS + 0.55;

const IDLE_FRAME_COUNT = 6;
const WALK_FRAME_COUNT = 7;
const IDLE_CYCLE_SECONDS = IDLE_FRAME_COUNT / SPRITE_ANIMATION_FPS;
const WALK_CYCLE_SECONDS = WALK_FRAME_COUNT / SPRITE_ANIMATION_FPS;
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
const THROW_VELOCITY_THRESHOLD = 180;
const IMPACT_SPEED_THRESHOLD = 180;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function getDeterministicSpawnX(userId: string, maxX: number): number {
  const spawnHash = Array.from(userId).reduce(
    (hash, character) => Math.imul(hash, 31) + character.charCodeAt(0),
    0,
  );
  return ((spawnHash >>> 0) / 0xffffffff) * Math.max(0, maxX);
}

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
  impactSequence = 0;
  isDragging = false;
  private stateDuration = randomIdleDuration();
  private speed = 0;
  private wanderTarget: number | null = null;
  private attackTarget: Goose | null = null;
  private surpriseAttacker: Goose | null = null;
  private avoidanceCooldown = 0;
  private nextAvoidanceAt = WALK_CYCLE_SECONDS;
  private remoteControlled = false;
  private remoteDragging = false;
  private remoteTargetX: number | null = null;
  private remoteTargetY: number | null = null;
  private menuOpen = false;
  private thrown = false;

  constructor(
    x: number,
    y: number,
    readonly name: string,
  ) {
    this.x = x;
    this.y = y;
  }

  quack(): void {
    if (this.menuOpen) {
      return;
    }
    this.cancelAttack();
    this.wanderTarget = null;
    this.transition("quack", 0.85);
  }

  attack(target: Goose): boolean {
    if (this.menuOpen) {
      return false;
    }
    this.cancelAttack();
    this.attackTarget = target;
    this.wanderTarget = null;
    this.direction = target.x >= this.x ? 1 : -1;
    if (Math.abs(target.x - this.x) <= attackContactDistance()) {
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
    this.cancelAttack();
    this.wanderTarget = null;
    this.surpriseAttacker = attacker;
    this.direction = attacker.x < this.x ? -1 : 1;
    this.transition("surprise", SURPRISE_DURATION_SECONDS);
  }

  finishSurprise(attacker?: Goose): void {
    if (
      this.state === "surprise" &&
      (attacker === undefined || this.surpriseAttacker === attacker)
    ) {
      this.surpriseAttacker = null;
      this.returnToIdle();
    }
  }

  setMenuOpen(open: boolean): void {
    if (this.menuOpen === open) {
      return;
    }
    this.menuOpen = open;
    if (open) {
      if (this.state === "surprise") {
        const attacker = this.surpriseAttacker;
        this.surpriseAttacker = null;
        attacker?.cancelAttack();
      } else {
        this.cancelAttack();
      }
      this.returnToIdle();
    } else {
      this.returnToIdle();
    }
  }

  getActionDuration(): number {
    return Number.isFinite(this.stateDuration)
      ? this.stateDuration
      : ATTACK_TIMEOUT_SECONDS;
  }

  applyRemoteAction(
    state: GooseState,
    direction: -1 | 1,
    stateElapsed: number,
    duration: number,
    actionRestarted: boolean,
    x: number,
    y: number,
    dragging: boolean,
    maxX: number,
    maxY: number,
  ): void {
    this.remoteControlled = true;
    this.remoteDragging = dragging;
    this.remoteTargetX = clamp(x, 0, maxX);
    this.remoteTargetY = clamp(y, 0, maxY);
    this.direction = direction;
    this.stateDuration = Math.max(0, duration);
    const nextElapsed = Math.min(
      Math.max(0, stateElapsed),
      this.stateDuration,
    );

    if (actionRestarted) {
      this.state = state;
      this.stateElapsed = nextElapsed;
      this.speed = 0;
      this.wanderTarget = null;
    } else {
      this.stateElapsed = Math.max(this.stateElapsed, nextElapsed);
    }
  }

  beginDrag(): void {
    this.isDragging = true;
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
    this.isDragging = false;
    this.velocityX = clamp(velocityX, -MAX_THROW_SPEED, MAX_THROW_SPEED);
    this.velocityY = clamp(velocityY, -MAX_THROW_SPEED, MAX_THROW_SPEED);
    this.thrown =
      Math.hypot(this.velocityX, this.velocityY) >= THROW_VELOCITY_THRESHOLD;
  }

  resize(maxX: number, maxY: number): void {
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
    if (this.remoteTargetX !== null) {
      this.remoteTargetX = clamp(this.remoteTargetX, 0, maxX);
    }
    if (this.remoteTargetY !== null) {
      this.remoteTargetY = clamp(this.remoteTargetY, 0, maxY);
    }
    if (this.wanderTarget !== null) {
      this.wanderTarget = clamp(this.wanderTarget, 0, maxX);
    }
  }

  update(
    deltaSeconds: number,
    maxX: number,
    floorY: number,
    other?: Goose,
  ): boolean {
    if (this.remoteControlled) {
      if (!this.remoteDragging) {
        this.stateElapsed += deltaSeconds;
      }
      const followRate = this.remoteDragging ? 24 : 18;
      const follow = 1 - Math.exp(-deltaSeconds * followRate);
      if (this.remoteTargetX !== null) {
        const distanceX = this.remoteTargetX - this.x;
        this.x =
          Math.abs(distanceX) < 1
            ? this.remoteTargetX
            : this.x + distanceX * follow;
      }
      if (this.remoteTargetY !== null) {
        const distanceY = this.remoteTargetY - this.y;
        this.y =
          Math.abs(distanceY) < 1
            ? this.remoteTargetY
            : this.y + distanceY * follow;
      }
      this.x = clamp(this.x, 0, maxX);
      this.y = clamp(this.y, 0, floorY);
      return false;
    }

    this.stateElapsed += deltaSeconds;
    this.avoidanceCooldown = Math.max(
      0,
      this.avoidanceCooldown - deltaSeconds,
    );
    let attackLanded = false;

    if (this.menuOpen && this.state !== "surprise") {
      this.state = "idle";
    } else {
      switch (this.state) {
        case "idle":
          if (!this.menuOpen && this.stateElapsed >= this.stateDuration) {
            this.startWandering(maxX);
          }
          break;
        case "wandering":
          if (
            this.stateElapsed < this.stateDuration &&
            this.stateElapsed + 0.02 >= this.nextAvoidanceAt
          ) {
            this.nextAvoidanceAt += WALK_CYCLE_SECONDS;
            if (other) {
              this.considerAvoidance(other, maxX);
            }
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
          if (this.stateElapsed >= this.stateDuration) {
            this.finishSurprise();
          }
          break;
      }
    }

    this.velocityY += GRAVITY * deltaSeconds;
    this.y += this.velocityY * deltaSeconds;
    if (this.y < 0) {
      if (this.thrown && Math.abs(this.velocityY) >= IMPACT_SPEED_THRESHOLD) {
        this.impactSequence += 1;
      }
      this.y = 0;
      this.velocityY = Math.abs(this.velocityY) * CEILING_BOUNCE;
    } else if (this.y >= floorY) {
      if (this.thrown && Math.abs(this.velocityY) >= IMPACT_SPEED_THRESHOLD) {
        this.impactSequence += 1;
      }
      this.y = floorY;
      this.velocityY = 0;
    }

    this.x += this.velocityX * deltaSeconds;
    if (this.x < 0) {
      if (this.thrown && Math.abs(this.velocityX) >= IMPACT_SPEED_THRESHOLD) {
        this.impactSequence += 1;
      }
      this.x = 0;
      this.velocityX = Math.abs(this.velocityX) * BOUNDARY_BOUNCE;
    } else if (this.x > maxX) {
      if (this.thrown && Math.abs(this.velocityX) >= IMPACT_SPEED_THRESHOLD) {
        this.impactSequence += 1;
      }
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
    if (
      this.y === floorY &&
      this.velocityY === 0 &&
      Math.abs(this.velocityX) < THROW_VELOCITY_THRESHOLD
    ) {
      this.thrown = false;
    }

    return attackLanded;
  }

  private considerAvoidance(other: Goose, maxX: number): void {
    const distance = Math.abs(other.x - this.x);
    if (
      this.avoidanceCooldown > 0 ||
      distance >= preferredGooseDistance()
    ) {
      return;
    }

    const closeness = 1 - distance / preferredGooseDistance();
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
    if (this.stateElapsed >= ATTACK_TIMEOUT_SECONDS) {
      this.cancelAttack();
      this.returnToIdle();
      return false;
    }

    const distance = this.attackTarget.x - this.x;
    this.direction = distance >= 0 ? 1 : -1;
    if (Math.abs(distance) <= attackContactDistance()) {
      this.wanderTarget = null;
      this.transition("peck", 0.55);
      return true;
    }

    this.moveToward(
      this.attackTarget.x - this.direction * attackContactDistance(),
      deltaSeconds,
      maxX,
    );
    const remainingDistance = this.attackTarget.x - this.x;
    if (
      Math.abs(remainingDistance) <= attackContactDistance() ||
      Math.sign(distance) !== Math.sign(remainingDistance)
    ) {
      this.transition("peck", 0.55);
      return true;
    }
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

  private cancelAttack(notifyTarget = true): void {
    if (notifyTarget) {
      this.attackTarget?.finishSurprise();
    }
    this.attackTarget = null;
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
