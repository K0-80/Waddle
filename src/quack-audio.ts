const honkUrl = new URL("./assets/sounds/honk.mp3", import.meta.url).href;
const attackUrl = new URL("./assets/sounds/attack.mp3", import.meta.url).href;
const runningUrl = new URL("./assets/sounds/running.mp3", import.meta.url).href;
const splatUrl = new URL("./assets/sounds/splat.mp3", import.meta.url).href;

const activeOneShots = new Set<HTMLAudioElement>();
const silentHonk = new Audio(honkUrl);
const splatAudio = new Audio(splatUrl);
const runningAudios = new Map<string, HTMLAudioElement>();
silentHonk.preload = "auto";
silentHonk.load();
splatAudio.preload = "auto";
splatAudio.load();
let audioUnlocked = false;
let unlockingAudio: Promise<void> | null = null;
let masterVolume = 1;
let muteWhenUnfocused = false;
let windowFocused = document.hasFocus();

function applyAudioSettings(audio: HTMLAudioElement): void {
  audio.volume = masterVolume;
  audio.muted = muteWhenUnfocused && !windowFocused;
}

function applyAudioSettingsToAll(): void {
  for (const audio of activeOneShots) {
    applyAudioSettings(audio);
  }
  for (const audio of runningAudios.values()) {
    applyAudioSettings(audio);
  }
  applyAudioSettings(splatAudio);
}

function updateWindowFocus(): void {
  windowFocused =
    document.hasFocus() && document.visibilityState === "visible";
  applyAudioSettingsToAll();
}

window.addEventListener("focus", updateWindowFocus);
window.addEventListener("blur", updateWindowFocus);
document.addEventListener("visibilitychange", updateWindowFocus);

export function unlockAudio(): void {
  if (audioUnlocked || unlockingAudio) {
    return;
  }

  silentHonk.muted = true;
  splatAudio.muted = true;
  unlockingAudio = Promise.all([silentHonk.play(), splatAudio.play()])
    .then(() => {
      silentHonk.pause();
      silentHonk.currentTime = 0;
      silentHonk.muted = false;
      splatAudio.pause();
      splatAudio.currentTime = 0;
      splatAudio.muted = false;
      audioUnlocked = true;
      applyAudioSettingsToAll();
    })
    .catch((error: unknown) => {
      silentHonk.pause();
      silentHonk.currentTime = 0;
      silentHonk.muted = false;
      splatAudio.pause();
      splatAudio.currentTime = 0;
      splatAudio.muted = false;
      applyAudioSettingsToAll();
      unlockingAudio = null;
      console.error("Could not prepare goose sounds for playback.", error);
    });
}

export function playHonkSound(): Promise<void> {
  return playOneShot(honkUrl);
}

export function playAttackSound(): Promise<void> {
  return playOneShot(attackUrl);
}

export function playSplatSound(): Promise<void> {
  applyAudioSettings(splatAudio);
  splatAudio.currentTime = 0;
  return splatAudio.play();
}

export function setMasterVolume(volume: number): void {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error("Volume must be between 0 and 1.");
  }
  masterVolume = volume;
  applyAudioSettingsToAll();
}

export function setMuteWhenUnfocused(mute: boolean): void {
  muteWhenUnfocused = mute;
  updateWindowFocus();
}

export async function startRunningSound(sourceId = "local"): Promise<void> {
  if (runningAudios.has(sourceId)) {
    return Promise.resolve();
  }

  const audio = new Audio(runningUrl);
  audio.loop = true;
  runningAudios.set(sourceId, audio);
  applyAudioSettings(audio);
  try {
    await audio.play();
  } catch (error) {
    if (runningAudios.get(sourceId) === audio) {
      runningAudios.delete(sourceId);
    }
    throw error;
  }
}

export function stopRunningSound(sourceId = "local"): void {
  const audio = runningAudios.get(sourceId);
  if (!audio) {
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  runningAudios.delete(sourceId);
}

async function playOneShot(url: string): Promise<void> {
  const audio = new Audio(url);
  activeOneShots.add(audio);
  applyAudioSettings(audio);
  audio.addEventListener(
    "ended",
    () => {
      activeOneShots.delete(audio);
    },
    { once: true },
  );

  try {
    await audio.play();
  } catch (error) {
    activeOneShots.delete(audio);
    throw error;
  }
}
