export const SPRITE_ANIMATION_FPS = 8;
export const GOOSE_WALK_SPEED = 80;
export const GOOSE_RUN_SPEED = 350;

export interface UserPreferences {
  alwaysOnTop: boolean;
  muteWhenUnfocused: boolean;
  alwaysShowNameTags: boolean;
  volume: number;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  alwaysOnTop: true,
  muteWhenUnfocused: false,
  alwaysShowNameTags: false,
  volume: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getUserPreferences(value: unknown): UserPreferences {
  const settings = isRecord(value) ? value : {};
  return {
    alwaysOnTop:
      typeof settings.alwaysOnTop === "boolean"
        ? settings.alwaysOnTop
        : DEFAULT_USER_PREFERENCES.alwaysOnTop,
    muteWhenUnfocused:
      typeof settings.muteWhenUnfocused === "boolean"
        ? settings.muteWhenUnfocused
        : DEFAULT_USER_PREFERENCES.muteWhenUnfocused,
    alwaysShowNameTags:
      typeof settings.alwaysShowNameTags === "boolean"
        ? settings.alwaysShowNameTags
        : DEFAULT_USER_PREFERENCES.alwaysShowNameTags,
    volume:
      typeof settings.volume === "number" &&
      Number.isFinite(settings.volume) &&
      settings.volume >= 0 &&
      settings.volume <= 1
        ? settings.volume
        : DEFAULT_USER_PREFERENCES.volume,
  };
}
