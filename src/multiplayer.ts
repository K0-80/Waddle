import {
  joinRoom as joinTrysteroRoom,
  type MessageAction,
  type Room,
  type RoomError,
  type UserState,
} from "trystero";
import { Goose, type GooseState } from "./goose";

const APP_ID = "k0-80/waddle";
export const MAX_ROOM_PLAYERS = 6;
const ATTACK_COOLDOWN_MS = 650;
const SYNC_INTERVAL_MS = 50;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const ROOM_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export type ConnectionState = "offline" | "connecting" | "online";

export interface RoomInfo {
  roomCode: string;
  playerCount: number;
  maxPlayers: number;
  joinedAt: number;
}

interface GooseAction {
  username: string;
  direction: -1 | 1;
  state: GooseState;
  stateElapsed: number;
  duration: number;
  xRatio: number;
  yRatio: number;
  dragging: boolean;
  sequence: number;
  actionSequence: number;
  targetUserId: string | null;
}

interface RemotePlayer {
  goose: Goose;
  sequence: number;
  actionSequence: number;
}

interface PendingAction {
  room: Room;
  state: UserState<GooseAction>;
  value: GooseAction;
}

interface MultiplayerUser {
  username: string;
}

interface AttackRequest {
  targetUserId: string;
  phase: "start" | "finish";
}

interface MultiplayerCallbacks {
  onConnectionChange: (state: ConnectionState) => void;
  onRoomInfoChange: (info: RoomInfo | null) => void;
  onError: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGooseState(value: unknown): value is GooseState {
  return (
    value === "idle" ||
    value === "wandering" ||
    value === "quack" ||
    value === "surprise" ||
    value === "attack" ||
    value === "peck"
  );
}

function parseAction(value: unknown): GooseAction | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    username,
    direction,
    state,
    stateElapsed,
    duration,
    xRatio,
    yRatio,
    dragging,
    sequence,
    actionSequence,
    targetUserId,
  } = value;
  if (
    typeof username !== "string" ||
    !USERNAME_PATTERN.test(username) ||
    (direction !== -1 && direction !== 1) ||
    !isGooseState(state) ||
    typeof stateElapsed !== "number" ||
    !Number.isFinite(stateElapsed) ||
    stateElapsed < 0 ||
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 60 ||
    typeof xRatio !== "number" ||
    !Number.isFinite(xRatio) ||
    xRatio < 0 ||
    xRatio > 1 ||
    typeof yRatio !== "number" ||
    !Number.isFinite(yRatio) ||
    yRatio < 0 ||
    yRatio > 1 ||
    typeof dragging !== "boolean" ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    typeof actionSequence !== "number" ||
    !Number.isSafeInteger(actionSequence) ||
    actionSequence < 0 ||
    (targetUserId !== null &&
      (typeof targetUserId !== "string" ||
        targetUserId.length < 8 ||
        targetUserId.length > 64))
  ) {
    return null;
  }

  return {
    username,
    direction,
    state,
    stateElapsed: Math.min(stateElapsed, duration),
    duration,
    xRatio,
    yRatio,
    dragging,
    sequence,
    actionSequence,
    targetUserId,
  };
}

export function normalizeRoomCode(value: string): string {
  const roomCode = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!ROOM_CODE_PATTERN.test(roomCode)) {
    throw new Error(
      "Room names must be 3–32 characters and use letters, numbers, hyphens, or underscores.",
    );
  }
  return roomCode;
}

export class Multiplayer {
  private readonly remotePlayers = new Map<string, RemotePlayer>();
  private readonly incomingAttackTimes = new Map<string, number>();
  private room: Room | null = null;
  private actionState: UserState<GooseAction> | null = null;
  private attackAction: MessageAction<AttackRequest> | null = null;
  private pendingAction: PendingAction | null = null;
  private actionPublishInFlight = false;
  private selfUserId: string | null = null;
  private localGoose: Goose | null = null;
  private maxX = 0;
  private maxY = 0;
  private localActionSequence = 0;
  private localActionVersion = 0;
  private lastObservedSignature = "";
  private lastObservedElapsed = 0;
  private lastActionPublishedAt = 0;
  private lastAttackAt = Number.NEGATIVE_INFINITY;
  private localAttackTargetId: string | null = null;
  private roomCode: string | null = null;
  private joinedAt = 0;
  private state: ConnectionState = "offline";

  constructor(
    private readonly user: MultiplayerUser,
    private readonly callbacks: MultiplayerCallbacks,
  ) {}

  setLocalGoose(goose: Goose, maxX: number, maxY: number): void {
    this.localGoose = goose;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  async createRoom(roomName: string): Promise<void> {
    await this.enterRoom(roomName);
  }

  async joinRoom(roomName: string): Promise<void> {
    await this.enterRoom(roomName);
  }

  getRemoteGeese(): Goose[] {
    return Array.from(this.remotePlayers.values(), ({ goose }) => goose);
  }

  getUserId(goose: Goose): string | undefined {
    return Array.from(this.remotePlayers.entries()).find(
      ([, player]) => player.goose === goose,
    )?.[0];
  }

  requestAttack(targetUserId: string): boolean {
    const now = performance.now();
    if (
      this.state !== "online" ||
      !this.room ||
      !this.localGoose ||
      !this.remotePlayers.has(targetUserId) ||
      now - this.lastAttackAt < ATTACK_COOLDOWN_MS
    ) {
      return false;
    }

    this.lastAttackAt = now;
    this.localAttackTargetId = targetUserId;
    this.sendAttackPhase(targetUserId, "start");
    return true;
  }

  finishAttack(targetUserId: string): void {
    if (
      this.state !== "online" ||
      !this.room ||
      !this.localGoose ||
      !this.remotePlayers.has(targetUserId)
    ) {
      return;
    }

    this.sendAttackPhase(targetUserId, "finish");
    if (this.localAttackTargetId === targetUserId) {
      this.localAttackTargetId = null;
    }
  }

  resize(maxX: number, maxY: number): void {
    this.maxX = maxX;
    this.maxY = maxY;
    for (const player of this.remotePlayers.values()) {
      player.goose.resize(maxX, maxY);
    }
  }

  update(goose: Goose, deltaSeconds: number): void {
    for (const player of this.remotePlayers.values()) {
      player.goose.update(deltaSeconds, this.maxX, this.maxY);
    }
    this.publishActionIfChanged(goose);
  }

  async leaveRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.actionState = null;
    this.attackAction = null;
    this.selfUserId = null;
    this.roomCode = null;
    this.joinedAt = 0;
    this.localAttackTargetId = null;
    this.remotePlayers.clear();
    this.incomingAttackTimes.clear();
    this.localActionSequence = 0;
    this.localActionVersion = 0;
    this.lastObservedSignature = "";
    this.lastObservedElapsed = 0;
    this.lastActionPublishedAt = 0;
    this.pendingAction = null;
    this.setState("offline");
    this.callbacks.onRoomInfoChange(null);

    if (room) {
      try {
        await room.leave();
      } catch (error) {
        console.error("Could not leave the Trystero room cleanly.", error);
        throw error;
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.leaveRoom();
  }

  private async enterRoom(roomName: string): Promise<void> {
    if (this.room || this.state === "connecting") {
      throw new Error("Leave the current room before joining another one.");
    }
    if (!this.localGoose) {
      throw new Error("Your goose is not ready to join a room.");
    }

    const roomCode = normalizeRoomCode(roomName);
    this.callbacks.onError("");
    this.setState("connecting");
    this.roomCode = roomCode;
    this.joinedAt = 0;

    let room: Room | null = null;
    try {
      const activeRoom = joinTrysteroRoom(
        {
          appId: APP_ID,
          maxUsers: MAX_ROOM_PLAYERS,
        },
        roomCode,
      );
      room = activeRoom;
      this.room = activeRoom;
      this.subscribeToRoom(activeRoom);

      await activeRoom.ready;
      if (this.room !== activeRoom) {
        return;
      }

      const self = await activeRoom.getSelf();
      if (this.room !== activeRoom) {
        return;
      }
      this.selfUserId = self.userId;
      const initialAction = this.makeAction(this.localGoose);
      this.actionState = activeRoom.makeUserState<GooseAction>(
        "goose-action",
        initialAction,
      );
      this.actionState.onChange(
        (value, context) => {
          if (context.self) {
            return;
          }
          if (context.removed || !value) {
            this.removeRemotePlayer(context.userId);
            this.updatePlayerCount(activeRoom);
            return;
          }
          this.applyAction(context.userId, value);
        },
        { replay: true },
      );

      const attackAction = activeRoom.makeAction<AttackRequest>("attack");
      this.attackAction = attackAction;
      attackAction.onMessage((request, context) => {
        if (this.room === activeRoom) {
          this.receiveAttack(context.userId, request);
        }
      });

      activeRoom.onUserJoin(
        () => {
          if (this.room === activeRoom) {
            this.updatePlayerCount(activeRoom);
          }
        },
        { replay: true },
      );
      activeRoom.onUserLeave(({ userId }) => {
        if (this.room === activeRoom) {
          this.removeRemotePlayer(userId);
          this.updatePlayerCount(activeRoom);
        }
      });

      await this.actionState.set(initialAction);
      if (this.room !== activeRoom) {
        return;
      }

      this.lastActionPublishedAt = performance.now();
      this.joinedAt = performance.now();
      this.setState("online");
      this.updatePlayerCount(activeRoom);
    } catch (error) {
      if (this.room === room) {
        this.room = null;
        this.actionState = null;
        this.attackAction = null;
        this.selfUserId = null;
        this.roomCode = null;
        this.joinedAt = 0;
        this.remotePlayers.clear();
        this.incomingAttackTimes.clear();
        this.callbacks.onRoomInfoChange(null);
        this.setState("offline");
        if (room) {
          try {
            await room.leave();
          } catch (leaveError) {
            console.error(
              "Could not clean up a failed Trystero room join.",
              leaveError,
            );
          }
        }
      } else if (!room) {
        this.roomCode = null;
        this.joinedAt = 0;
        this.callbacks.onRoomInfoChange(null);
        this.setState("offline");
      }
      throw error;
    }
  }

  private subscribeToRoom(room: Room): void {
    room.onError((error) => {
      this.handleRoomError(room, error);
    });
  }

  private handleRoomError(room: Room, error: RoomError): void {
    if (this.room !== room) {
      return;
    }

    if (error.code === "room-full") {
      this.callbacks.onError("This room is full (maximum 6 players).");
      void this.leaveRoom().catch((leaveError: unknown) => {
        console.error("Could not leave the full Trystero room.", leaveError);
      });
      return;
    }

    this.callbacks.onError(error.message);
    if (
      this.state === "connecting" &&
      (error.code === "relay-failed" || error.code === "identity-failed")
    ) {
      void this.leaveRoom().catch((leaveError: unknown) => {
        console.error("Could not leave the failed Trystero room.", leaveError);
      });
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.callbacks.onConnectionChange(state);
  }

  private updatePlayerCount(room: Room): void {
    if (this.room !== room || !this.roomCode || this.state !== "online") {
      return;
    }

    const playerCount = Math.min(
      Object.keys(room.getUsers()).length + 1,
      MAX_ROOM_PLAYERS,
    );
    this.callbacks.onRoomInfoChange({
      roomCode: this.roomCode,
      playerCount,
      maxPlayers: MAX_ROOM_PLAYERS,
      joinedAt: this.joinedAt,
    });
  }

  private applyAction(userId: string, value: unknown): void {
    const action = parseAction(value);
    if (!action) {
      return;
    }

    let remotePlayer = this.remotePlayers.get(userId);
    if (!remotePlayer || remotePlayer.goose.name !== action.username) {
      remotePlayer = {
        goose: new Goose(
          action.xRatio * this.maxX,
          action.yRatio * this.maxY,
          action.username,
        ),
        sequence: -1,
        actionSequence: -1,
      };
      this.remotePlayers.set(userId, remotePlayer);
    }
    if (action.sequence < remotePlayer.sequence) {
      return;
    }
    if (action.actionSequence < remotePlayer.actionSequence) {
      return;
    }

    const actionRestarted =
      action.actionSequence > remotePlayer.actionSequence;
    remotePlayer.sequence = action.sequence;
    remotePlayer.actionSequence = action.actionSequence;
    const x = action.xRatio * this.maxX;
    const y = action.yRatio * this.maxY;
    remotePlayer.goose.applyRemoteAction(
      action.state,
      action.direction,
      action.stateElapsed,
      action.duration,
      actionRestarted,
      x,
      y,
      action.dragging,
      this.maxX,
      this.maxY,
    );
  }

  private removeRemotePlayer(userId: string): void {
    this.remotePlayers.delete(userId);
    this.incomingAttackTimes.delete(userId);
  }

  private receiveAttack(attackerUserId: string, value: unknown): void {
    if (
      !isRecord(value) ||
      typeof value.targetUserId !== "string" ||
      value.targetUserId !== this.selfUserId ||
      (value.phase !== "start" && value.phase !== "finish") ||
      !this.localGoose
    ) {
      return;
    }

    const attacker = this.remotePlayers.get(attackerUserId);
    if (!attacker) {
      return;
    }

    if (value.phase === "finish") {
      this.localGoose.finishSurprise(attacker.goose);
      return;
    }

    const now = performance.now();
    const previousAttackAt =
      this.incomingAttackTimes.get(attackerUserId) ??
      Number.NEGATIVE_INFINITY;
    if (now - previousAttackAt < ATTACK_COOLDOWN_MS) {
      return;
    }
    this.incomingAttackTimes.set(attackerUserId, now);
    this.localGoose.prepareForAttack(attacker.goose);
  }

  private sendAttackPhase(
    targetUserId: string,
    phase: AttackRequest["phase"],
  ): void {
    const room = this.room;
    const attackAction = this.attackAction;
    if (!room || !attackAction || this.state !== "online") {
      return;
    }

    void attackAction
      .send({ targetUserId, phase }, { target: targetUserId })
      .catch((error: unknown) => {
        console.error("Could not send an attack request.", error);
      });
  }

  private publishActionIfChanged(goose: Goose): void {
    const room = this.room;
    const actionState = this.actionState;
    if (!room || !actionState || this.state !== "online") {
      return;
    }

    const now = performance.now();
    if (now - this.lastActionPublishedAt < SYNC_INTERVAL_MS) {
      return;
    }

    const action = this.makeAction(goose);
    this.lastActionPublishedAt = now;
    this.pendingAction = { room, state: actionState, value: action };
    void this.flushPendingActions();
  }

  private async flushPendingActions(): Promise<void> {
    if (this.actionPublishInFlight) {
      return;
    }

    this.actionPublishInFlight = true;
    try {
      while (this.pendingAction) {
        const pending = this.pendingAction;
        this.pendingAction = null;
        if (
          this.room !== pending.room ||
          this.actionState !== pending.state ||
          this.state !== "online"
        ) {
          continue;
        }
        try {
          await pending.state.set(pending.value);
        } catch (error) {
          console.error("Could not publish the goose action.", error);
        }
      }
    } finally {
      this.actionPublishInFlight = false;
      if (this.pendingAction) {
        void this.flushPendingActions();
      }
    }
  }

  private makeAction(goose: Goose): GooseAction {
    const targetUserId =
      goose.state === "attack" || goose.state === "peck"
        ? this.localAttackTargetId
        : null;
    const signature = `${goose.state}:${goose.direction}:${goose.isDragging}:${targetUserId ?? ""}`;
    if (
      signature !== this.lastObservedSignature ||
      goose.stateElapsed + 0.02 < this.lastObservedElapsed
    ) {
      this.localActionVersion += 1;
    }
    this.localActionSequence += 1;
    this.lastObservedSignature = signature;
    this.lastObservedElapsed = goose.stateElapsed;

    return {
      username: this.user.username,
      direction: goose.direction,
      state: goose.state,
      stateElapsed: goose.stateElapsed,
      duration: goose.getActionDuration(),
      xRatio: this.maxX > 0 ? goose.x / this.maxX : 0,
      yRatio: this.maxY > 0 ? goose.y / this.maxY : 1,
      dragging: goose.isDragging,
      sequence: this.localActionSequence,
      actionSequence: this.localActionVersion,
      targetUserId,
    };
  }
}
