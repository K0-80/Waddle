import {
  joinRoom as joinTrysteroRoom,
  type MessageAction,
  type Room,
  type RoomError,
  type TurnServerConfig,
  type UserState,
} from "trystero";
import { Goose, type GooseState } from "./goose";

const APP_ID = "k0-80/waddle";
export const MAX_ROOM_PLAYERS = 10;
const ATTACK_COOLDOWN_MS = 650;
const SYNC_INTERVAL_MS = 50;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const ROOM_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

function getTurnConfig(): TurnServerConfig[] {
  const rawUrls: unknown = import.meta.env.VITE_TURN_URLS;
  const rawUsername: unknown = import.meta.env.VITE_TURN_USERNAME;
  const rawCredential: unknown = import.meta.env.VITE_TURN_CREDENTIAL;
  const urls =
    typeof rawUrls === "string"
      ? rawUrls
          .split(",")
          .map((url) => url.trim())
          .filter((url) => url.length > 0)
      : [];
  const username = typeof rawUsername === "string" ? rawUsername.trim() : "";
  const credential =
    typeof rawCredential === "string" ? rawCredential.trim() : "";

  if (urls.length === 0) {
    if (username || credential) {
      throw new Error("Set VITE_TURN_URLS to use TURN credentials.");
    }
    return [];
  }

  if (urls.some((url) => !/^turns?:/i.test(url))) {
    throw new Error("VITE_TURN_URLS must contain TURN or TURNS URLs.");
  }
  if (Boolean(username) !== Boolean(credential)) {
    throw new Error(
      "Set both VITE_TURN_USERNAME and VITE_TURN_CREDENTIAL, or neither.",
    );
  }

  return [
    {
      urls,
      ...(username && credential ? { username, credential } : {}),
    },
  ];
}

export type ConnectionState = "offline" | "connecting" | "online";

export interface RoomInfo {
  roomCode: string;
  playerCount: number;
  maxPlayers: number;
  roomStartedAt: number;
}

interface GooseAction {
  username: string;
  aboutMe: string;
  isHost: boolean;
  joinedAt: number;
  direction: -1 | 1;
  state: GooseState;
  stateElapsed: number;
  duration: number;
  roomStartedAt: number;
  xRatio: number;
  yRatio: number;
  dragging: boolean;
  sequence: number;
  actionSequence: number;
  impactSequence: number;
  targetUserId: string | null;
}

interface RemotePlayer {
  goose: Goose;
  aboutMe: string;
  joinedAt: number;
  sequence: number;
  actionSequence: number;
  impactSequence: number;
}

interface PendingAction {
  room: Room;
  state: UserState<GooseAction>;
  value: GooseAction;
}

interface MultiplayerUser {
  username: string;
  aboutMe: string;
}

export interface RemoteProfile {
  username: string;
  aboutMe: string;
}

interface AttackRequest {
  targetUserId: string;
  phase: "start" | "finish";
}

export type RoomSound = "honk" | "attack" | "running-start" | "running-stop";

interface MultiplayerCallbacks {
  onConnectionChange: (state: ConnectionState) => void;
  onRoomInfoChange: (info: RoomInfo | null) => void;
  onImpactSound: () => void;
  onRoomSound: (userId: string, sound: RoomSound) => void;
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
    aboutMe,
    isHost,
    joinedAt,
    direction,
    state,
    stateElapsed,
    duration,
    roomStartedAt,
    xRatio,
    yRatio,
    dragging,
    sequence,
    actionSequence,
    impactSequence: rawImpactSequence,
    targetUserId,
  } = value;
  const impactSequence = rawImpactSequence ?? 0;
  if (
    typeof username !== "string" ||
    !USERNAME_PATTERN.test(username) ||
    typeof aboutMe !== "string" ||
    aboutMe.length > 160 ||
    typeof isHost !== "boolean" ||
    typeof joinedAt !== "number" ||
    !Number.isSafeInteger(joinedAt) ||
    joinedAt <= 0 ||
    (direction !== -1 && direction !== 1) ||
    !isGooseState(state) ||
    typeof stateElapsed !== "number" ||
    !Number.isFinite(stateElapsed) ||
    stateElapsed < 0 ||
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 60 ||
    typeof roomStartedAt !== "number" ||
    !Number.isFinite(roomStartedAt) ||
    roomStartedAt <= 0 ||
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
    typeof impactSequence !== "number" ||
    !Number.isSafeInteger(impactSequence) ||
    impactSequence < 0 ||
    (targetUserId !== null &&
      (typeof targetUserId !== "string" ||
        targetUserId.length < 8 ||
        targetUserId.length > 64))
  ) {
    return null;
  }

  return {
    username,
    aboutMe,
    isHost,
    joinedAt,
    direction,
    state,
    stateElapsed: Math.min(stateElapsed, duration),
    duration,
    roomStartedAt,
    xRatio,
    yRatio,
    dragging,
    sequence,
    actionSequence,
    impactSequence,
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
  private soundAction: MessageAction<RoomSound> | null = null;
  private readonly runningSoundUsers = new Set<string>();
  private pendingAction: PendingAction | null = null;
  private actionPublishInFlight = false;
  private selfUserId: string | null = null;
  private joinedAt = 0;
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
  private roomStartedAt = 0;
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

  getRemoteProfile(goose: Goose): RemoteProfile | undefined {
    const player = Array.from(this.remotePlayers.values()).find(
      (candidate) => candidate.goose === goose,
    );
    return player
      ? {
          username: player.goose.name,
          aboutMe: player.aboutMe,
        }
      : undefined;
  }

  updateAboutMe(aboutMe: string): void {
    if (aboutMe.length > 160) {
      throw new Error("About Me must be 160 characters or fewer.");
    }
    this.user.aboutMe = aboutMe;
  }

  broadcastSound(sound: RoomSound): void {
    const soundAction = this.soundAction;
    if (!soundAction || this.state !== "online") {
      return;
    }

    void soundAction.send(sound).catch((error: unknown) => {
      console.error(`Could not broadcast the ${sound} sound event.`, error);
    });
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
    this.soundAction = null;
    this.selfUserId = null;
    this.joinedAt = 0;
    this.roomCode = null;
    this.roomStartedAt = 0;
    this.localAttackTargetId = null;
    this.stopRemoteRunningSounds();
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
    this.roomStartedAt = Date.now();

    let room: Room | null = null;
    try {
      const turnConfig = getTurnConfig();
      const activeRoom = joinTrysteroRoom(
        {
          appId: APP_ID,
          maxUsers: MAX_ROOM_PLAYERS,
          ...(turnConfig.length > 0 ? { turnConfig } : {}),
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
      this.joinedAt = Date.now();
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

      const soundAction = activeRoom.makeAction<RoomSound>("goose-sound");
      this.soundAction = soundAction;
      soundAction.onMessage((sound, context) => {
        if (
          this.room === activeRoom &&
          context.userId !== this.selfUserId &&
          (sound === "honk" ||
            sound === "attack" ||
            sound === "running-start" ||
            sound === "running-stop")
        ) {
          this.receiveRoomSound(context.userId, sound);
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
      this.setState("online");
      this.updatePlayerCount(activeRoom);
    } catch (error) {
      if (this.room === room) {
        this.room = null;
        this.actionState = null;
        this.attackAction = null;
        this.soundAction = null;
        this.selfUserId = null;
        this.joinedAt = 0;
        this.roomCode = null;
        this.roomStartedAt = 0;
        this.stopRemoteRunningSounds();
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
        this.roomStartedAt = 0;
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

    if (error.code === "peer-connect-failed") {
      this.callbacks.onError(
        error.turnConfigured
          ? `${error.message} Check the TURN server URLs and credentials.`
          : `${error.message} This network may require a TURN relay. Configure VITE_TURN_URLS in .env.local and restart the app.`,
      );
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
      roomStartedAt: this.roomStartedAt,
    });
  }

  private applyAction(userId: string, value: unknown): void {
    const action = parseAction(value);
    if (!action) {
      return;
    }

    let remotePlayer = this.remotePlayers.get(userId);
    let isNewPlayer = false;
    if (!remotePlayer || remotePlayer.goose.name !== action.username) {
      remotePlayer = {
        goose: new Goose(
          action.xRatio * this.maxX,
          action.yRatio * this.maxY,
          action.username,
        ),
        aboutMe: action.aboutMe,
        joinedAt: action.joinedAt,
        sequence: -1,
        actionSequence: -1,
        impactSequence: action.impactSequence,
      };
      this.remotePlayers.set(userId, remotePlayer);
      isNewPlayer = true;
    }
    if (action.sequence < remotePlayer.sequence) {
      return;
    }
    if (action.actionSequence < remotePlayer.actionSequence) {
      return;
    }

    if (
      action.roomStartedAt < this.roomStartedAt ||
      this.roomStartedAt === 0
    ) {
      this.roomStartedAt = action.roomStartedAt;
      if (this.room) {
        this.updatePlayerCount(this.room);
      }
    }

    const actionRestarted =
      action.actionSequence > remotePlayer.actionSequence;
    if (!isNewPlayer && action.impactSequence > remotePlayer.impactSequence) {
      const newImpacts = Math.min(
        action.impactSequence - remotePlayer.impactSequence,
        2,
      );
      for (let impact = 0; impact < newImpacts; impact += 1) {
        this.callbacks.onImpactSound();
      }
    }
    remotePlayer.sequence = action.sequence;
    remotePlayer.actionSequence = action.actionSequence;
    remotePlayer.impactSequence = action.impactSequence;
    remotePlayer.aboutMe = action.aboutMe;
    remotePlayer.joinedAt = action.joinedAt;
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
    if (this.runningSoundUsers.delete(userId)) {
      this.callbacks.onRoomSound(userId, "running-stop");
    }
  }

  private receiveRoomSound(userId: string, sound: RoomSound): void {
    if (sound === "running-start") {
      if (this.runningSoundUsers.has(userId)) {
        return;
      }
      this.runningSoundUsers.add(userId);
    } else if (sound === "running-stop") {
      if (!this.runningSoundUsers.delete(userId)) {
        return;
      }
    }
    this.callbacks.onRoomSound(userId, sound);
  }

  private stopRemoteRunningSounds(): void {
    for (const userId of this.runningSoundUsers) {
      this.callbacks.onRoomSound(userId, "running-stop");
    }
    this.runningSoundUsers.clear();
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
    const localUserId = this.selfUserId;
    const hostParticipant = [
      ...(localUserId && this.joinedAt > 0
        ? [{ userId: localUserId, joinedAt: this.joinedAt }]
        : []),
      ...Array.from(this.remotePlayers.entries(), ([userId, player]) => ({
        userId,
        joinedAt: player.joinedAt,
      })),
    ].sort(
      (first, second) =>
        first.joinedAt - second.joinedAt ||
        first.userId.localeCompare(second.userId),
    )[0];

    return {
      username: this.user.username,
      aboutMe: this.user.aboutMe,
      isHost: hostParticipant?.userId === localUserId,
      joinedAt: this.joinedAt,
      direction: goose.direction,
      state: goose.state,
      stateElapsed: goose.stateElapsed,
      duration: goose.getActionDuration(),
      roomStartedAt: this.roomStartedAt,
      xRatio: this.maxX > 0 ? goose.x / this.maxX : 0,
      yRatio: this.maxY > 0 ? goose.y / this.maxY : 1,
      dragging: goose.isDragging,
      sequence: this.localActionSequence,
      actionSequence: this.localActionVersion,
      impactSequence: goose.impactSequence,
      targetUserId,
    };
  }
}
