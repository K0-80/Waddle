type SoundEffect = "quack" | "surprised" | "attacked";

interface SoundProfile {
  startFrequency: number;
  middleFrequency: number;
  endFrequency: number;
  duration: number;
  volume: number;
  waveform: OscillatorType;
  filterFrequency: number;
}

const soundProfiles: Record<SoundEffect, SoundProfile> = {
  quack: {
    startFrequency: 460,
    middleFrequency: 150,
    endFrequency: 190,
    duration: 0.32,
    volume: 0.16,
    waveform: "sawtooth",
    filterFrequency: 1000,
  },
  surprised: {
    startFrequency: 420,
    middleFrequency: 760,
    endFrequency: 620,
    duration: 0.24,
    volume: 0.12,
    waveform: "triangle",
    filterFrequency: 1400,
  },
  attacked: {
    startFrequency: 210,
    middleFrequency: 100,
    endFrequency: 70,
    duration: 0.22,
    volume: 0.18,
    waveform: "triangle",
    filterFrequency: 650,
  },
};

let audioContext: AudioContext | undefined;

export async function playSoundEffect(effect: SoundEffect): Promise<void> {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio is not available in this webview.");
  }

  audioContext ??= new AudioContextConstructor();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const profile = soundProfiles[effect];
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const filter = audioContext.createBiquadFilter();
  const volume = audioContext.createGain();

  oscillator.type = profile.waveform;
  oscillator.frequency.setValueAtTime(profile.startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(
    profile.middleFrequency,
    now + profile.duration * 0.6,
  );
  oscillator.frequency.exponentialRampToValueAtTime(
    profile.endFrequency,
    now + profile.duration,
  );
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(profile.filterFrequency, now);
  volume.gain.setValueAtTime(0.001, now);
  volume.gain.exponentialRampToValueAtTime(profile.volume, now + 0.025);
  volume.gain.exponentialRampToValueAtTime(
    0.001,
    now + profile.duration,
  );

  oscillator.connect(filter);
  filter.connect(volume);
  volume.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + profile.duration + 0.01);
}
