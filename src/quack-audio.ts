const honkUrl = new URL("./assets/sounds/honk.mp3", import.meta.url).href;
const attackUrl = new URL("./assets/sounds/attack.mp3", import.meta.url).href;
const runningUrl = new URL("./assets/sounds/running.mp3", import.meta.url).href;

const activeOneShots = new Set<HTMLAudioElement>();
let runningAudio: HTMLAudioElement | null = null;

export function playHonkSound(): Promise<void> {
  return playOneShot(honkUrl);
}

export function playAttackSound(): Promise<void> {
  return playOneShot(attackUrl);
}

export function startRunningSound(): Promise<void> {
  if (runningAudio) {
    return Promise.resolve();
  }

  const audio = new Audio(runningUrl);
  audio.loop = true;
  runningAudio = audio;
  return audio.play();
}

export function stopRunningSound(): void {
  if (!runningAudio) {
    return;
  }

  runningAudio.pause();
  runningAudio.currentTime = 0;
  runningAudio = null;
}

async function playOneShot(url: string): Promise<void> {
  const audio = new Audio(url);
  activeOneShots.add(audio);
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
