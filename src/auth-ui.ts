import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "./supabase";
import {
  DEFAULT_USER_PREFERENCES,
  getUserPreferences,
  type UserPreferences,
} from "./settings";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

interface AuthenticatedUser {
  id: string;
  username: string;
  aboutMe: string;
  preferences: UserPreferences;
}

interface AuthUiCallbacks {
  onAuthenticated: (
    client: SupabaseClient,
    user: AuthenticatedUser,
  ) => void;
  onSettingsChange: (preferences: UserPreferences) => void;
  onAboutMeChange: (aboutMe: string) => void;
  onSignedOut: () => void;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`The authentication UI is missing ${selector}.`);
  }
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function getAboutMe(settings: unknown): string {
  if (
    typeof settings !== "object" ||
    settings === null ||
    !("aboutMe" in settings) ||
    typeof settings.aboutMe !== "string"
  ) {
    return "";
  }
  return settings.aboutMe.slice(0, 160);
}

export function startAuthUi(callbacks: AuthUiCallbacks): void {
  const panel = requiredElement<HTMLElement>("#auth-panel");
  const form = requiredElement<HTMLFormElement>("#auth-form");
  const usernameField = requiredElement<HTMLElement>("#username-field");
  const emailInput = requiredElement<HTMLInputElement>("#auth-email");
  const usernameInput = requiredElement<HTMLInputElement>("#auth-username");
  const passwordInput = requiredElement<HTMLInputElement>("#auth-password");
  const submitButton = requiredElement<HTMLButtonElement>("#auth-submit");
  const modeButton = requiredElement<HTMLButtonElement>("#auth-mode-toggle");
  const status = requiredElement<HTMLElement>("#auth-status");
  const sessionBar = requiredElement<HTMLElement>("#session-bar");
  const sessionName = requiredElement<HTMLElement>("#session-name");
  const signOutButton = requiredElement<HTMLButtonElement>("#sign-out");
  const aboutMeInput = requiredElement<HTMLTextAreaElement>("#about-me-input");
  const aboutMeStatus = requiredElement<HTMLElement>("#about-me-status");
  const settingsStatus = requiredElement<HTMLElement>("#settings-status");
  const alwaysOnTopInput =
    requiredElement<HTMLInputElement>("#always-on-top");
  const muteUnfocusedInput =
    requiredElement<HTMLInputElement>("#mute-unfocused");
  const alwaysShowNameTagsInput =
    requiredElement<HTMLInputElement>("#always-show-nametags");
  const volumeInput = requiredElement<HTMLInputElement>("#volume-input");
  const volumeValue = requiredElement<HTMLOutputElement>("#volume-value");
  const resizeAboutMeInput = (): void => {
    aboutMeInput.style.height = "auto";
    aboutMeInput.style.height = `${aboutMeInput.scrollHeight + 4}px`;
  };

  const showStatus = (message: string, isError = false): void => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };

  let client: SupabaseClient;
  try {
    client = createSupabaseClient();
  } catch (error) {
    showStatus(errorMessage(error), true);
    return;
  }

  let mode: "sign-in" | "sign-up" = "sign-in";
  let activeUserId: string | null = null;
  let latestSessionUserId: string | null = null;
  let loadingProfileUserId: string | null = null;
  let activeProfileSettings: Record<string, unknown> = {};
  let settingsSaveQueue: Promise<void> = Promise.resolve();
  let aboutMeSaveTimer: number | null = null;
  let aboutMeStatusTimer: number | null = null;

  const renderUserPreferences = (preferences: UserPreferences): void => {
    alwaysOnTopInput.checked = preferences.alwaysOnTop;
    muteUnfocusedInput.checked = preferences.muteWhenUnfocused;
    alwaysShowNameTagsInput.checked = preferences.alwaysShowNameTags;
    volumeInput.value = String(preferences.volume);
    volumeValue.value = `${Math.round(preferences.volume * 100)}%`;
  };

  const writeProfileSettings = (
    patch: Partial<UserPreferences> & { aboutMe?: string },
  ): Promise<void> => {
    const userId = activeUserId;
    if (!userId) {
      return Promise.reject(new Error("Sign in to save your settings."));
    }

    const operation = settingsSaveQueue.then(async () => {
      if (activeUserId !== userId) {
        throw new Error("Your session changed before settings were saved.");
      }

      const nextSettings = { ...activeProfileSettings, ...patch };
      const { data, error } = await client
        .from("profiles")
        .update({ settings: nextSettings })
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new Error("Your profile settings could not be updated.");
      }
      if (activeUserId === userId) {
        activeProfileSettings = nextSettings;
      }
    });
    settingsSaveQueue = operation.catch(() => undefined);
    return operation;
  };

  const saveUserPreferences = async (
    patch: Partial<UserPreferences>,
  ): Promise<void> => {
    callbacks.onSettingsChange({
      ...getUserPreferences(activeProfileSettings),
      ...patch,
    });
    settingsStatus.textContent = "Saving...";
    settingsStatus.classList.remove("error");
    try {
      await writeProfileSettings(patch);
      const preferences = getUserPreferences(activeProfileSettings);
      renderUserPreferences(preferences);
      callbacks.onSettingsChange(preferences);
      settingsStatus.textContent = "Saved";
    } catch (error) {
      const preferences = getUserPreferences(activeProfileSettings);
      renderUserPreferences(preferences);
      callbacks.onSettingsChange(preferences);
      settingsStatus.textContent = `Could not save settings: ${errorMessage(error)}`;
      settingsStatus.classList.add("error");
    }
  };

  const saveAboutMeNow = (): void => {
    if (aboutMeSaveTimer !== null) {
      window.clearTimeout(aboutMeSaveTimer);
      aboutMeSaveTimer = null;
    }
    void saveAboutMe().catch((error: unknown) => {
      aboutMeStatus.textContent = `Could not save: ${errorMessage(error)}`;
      aboutMeStatus.classList.add("error");
    });
  };

  const showSignedOutUi = (): void => {
    if (aboutMeSaveTimer !== null) {
      window.clearTimeout(aboutMeSaveTimer);
      aboutMeSaveTimer = null;
    }
    if (aboutMeStatusTimer !== null) {
      window.clearTimeout(aboutMeStatusTimer);
      aboutMeStatusTimer = null;
    }
    latestSessionUserId = null;
    activeUserId = null;
    activeProfileSettings = {};
    renderUserPreferences(DEFAULT_USER_PREFERENCES);
    settingsStatus.textContent = "";
    settingsStatus.classList.remove("error");
    aboutMeInput.value = "";
    aboutMeStatus.textContent = "";
    aboutMeStatus.classList.remove("error");
    panel.hidden = false;
    sessionBar.hidden = true;
    callbacks.onSignedOut();
  };

  const restoreSession = async (
    session: NonNullable<
      Awaited<ReturnType<typeof client.auth.getSession>>["data"]["session"]
    >,
  ): Promise<void> => {
    if (
      activeUserId === session.user.id ||
      loadingProfileUserId === session.user.id ||
      latestSessionUserId !== session.user.id
    ) {
      return;
    }

    loadingProfileUserId = session.user.id;
    try {
      const { data: profile, error } = await client
        .from("profiles")
        .select("username, settings")
        .eq("id", session.user.id)
        .maybeSingle();

      if (latestSessionUserId !== session.user.id) {
        return;
      }
      if (error || !profile) {
        activeUserId = null;
        panel.hidden = false;
        sessionBar.hidden = false;
        sessionName.textContent = "Profile setup required";
        showStatus(
          error
            ? `Could not load your profile: ${error.message}`
            : "Your profile is missing. Run the Supabase SQL migration from supabase/migrations.",
          true,
        );
        callbacks.onSignedOut();
        return;
      }

      activeUserId = session.user.id;
      const settings = profile.settings;
      activeProfileSettings =
        typeof settings === "object" && settings !== null && !Array.isArray(settings)
          ? { ...settings }
          : {};
      const aboutMe = getAboutMe(settings);
      const preferences = getUserPreferences(settings);
      panel.hidden = true;
      sessionBar.hidden = false;
      sessionName.textContent = profile.username;
      aboutMeInput.value = aboutMe;
      renderUserPreferences(preferences);
      aboutMeStatus.textContent = "";
      aboutMeStatus.classList.remove("error");
      settingsStatus.textContent = "";
      settingsStatus.classList.remove("error");
      showStatus("");
      callbacks.onAuthenticated(client, {
        id: session.user.id,
        username: profile.username,
        aboutMe,
        preferences,
      });
      resizeAboutMeInput();
    } finally {
      if (loadingProfileUserId === session.user.id) {
        loadingProfileUserId = null;
      }
    }
  };

  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      showSignedOutUi();
      return;
    }

    latestSessionUserId = session.user.id;
    window.setTimeout(() => {
      void restoreSession(session).catch((error: unknown) => {
        showStatus(`Could not restore your session: ${errorMessage(error)}`, true);
      });
    }, 0);
  });

  void client.auth
    .getSession()
    .then(({ data: { session }, error }) => {
      if (error) {
        throw error;
      }
      if (session) {
        if (latestSessionUserId === null) {
          latestSessionUserId = session.user.id;
        }
        return restoreSession(session);
      }
      if (latestSessionUserId === null) {
        showSignedOutUi();
      }
    })
    .catch((error: unknown) => {
      showStatus(`Could not check your session: ${errorMessage(error)}`, true);
    });

  const setMode = (nextMode: "sign-in" | "sign-up"): void => {
    mode = nextMode;
    const signingUp = mode === "sign-up";
    usernameField.hidden = !signingUp;
    usernameInput.required = signingUp;
    passwordInput.autocomplete = signingUp ? "new-password" : "current-password";
    submitButton.textContent = signingUp ? "Create account" : "Sign in";
    modeButton.textContent = signingUp
      ? "Already have an account? Sign in"
      : "New here? Create an account";
    showStatus("");
  };

  modeButton.addEventListener("click", () => {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitForm().catch((error: unknown) => {
      showStatus(errorMessage(error), true);
    });
  });

  async function submitForm(): Promise<void> {
    if (submitButton.disabled) {
      return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const username = usernameInput.value.trim();
    if (mode === "sign-up" && !USERNAME_PATTERN.test(username)) {
      showStatus(
        "Username must be 3–20 characters and use only letters, numbers, or underscores.",
        true,
      );
      return;
    }

    submitButton.disabled = true;
    modeButton.disabled = true;
    showStatus(mode === "sign-up" ? "Creating your account…" : "Signing in…");

    try {
      if (mode === "sign-up") {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { username } },
        });
        if (error) {
          throw error;
        }
        if (!data.session) {
          showStatus(
            "Signup returned no session. Disable Confirm email under Supabase Authentication settings to enable immediate sign-in.",
            true,
          );
        }
      } else {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          throw error;
        }
      }
    } catch (error) {
      showStatus(errorMessage(error), true);
    } finally {
      submitButton.disabled = false;
      modeButton.disabled = false;
    }
  }

  signOutButton.addEventListener("click", () => {
    void client.auth
      .signOut()
      .then(({ error }) => {
        if (error) {
          throw error;
        }
      })
      .catch((error: unknown) => {
        showStatus(`Could not sign out: ${errorMessage(error)}`, true);
      });
  });

  alwaysOnTopInput.addEventListener("change", () => {
    void saveUserPreferences({ alwaysOnTop: alwaysOnTopInput.checked });
  });
  muteUnfocusedInput.addEventListener("change", () => {
    void saveUserPreferences({
      muteWhenUnfocused: muteUnfocusedInput.checked,
    });
  });
  alwaysShowNameTagsInput.addEventListener("change", () => {
    void saveUserPreferences({
      alwaysShowNameTags: alwaysShowNameTagsInput.checked,
    });
  });
  volumeInput.addEventListener("input", () => {
    const volume = Number(volumeInput.value);
    volumeValue.value = `${Math.round(volume * 100)}%`;
    callbacks.onSettingsChange({
      ...getUserPreferences(activeProfileSettings),
      volume,
    });
  });
  volumeInput.addEventListener("change", () => {
    void saveUserPreferences({ volume: Number(volumeInput.value) });
  });
  aboutMeInput.addEventListener("input", () => {
    resizeAboutMeInput();
    aboutMeStatus.textContent = "";
    aboutMeStatus.classList.remove("error");
    if (aboutMeSaveTimer !== null) {
      window.clearTimeout(aboutMeSaveTimer);
    }
    if (aboutMeStatusTimer !== null) {
      window.clearTimeout(aboutMeStatusTimer);
      aboutMeStatusTimer = null;
    }
    aboutMeSaveTimer = window.setTimeout(() => {
      aboutMeSaveTimer = null;
      saveAboutMeNow();
    }, 500);
  });
  aboutMeInput.addEventListener("blur", () => {
    if (aboutMeSaveTimer !== null) {
      saveAboutMeNow();
    }
  });

  async function saveAboutMe(): Promise<void> {
    if (!activeUserId) {
      return;
    }

    const userId = activeUserId;
    const aboutMe = aboutMeInput.value.trim();
    if (aboutMe.length > 160) {
      aboutMeStatus.textContent = "About Me must be 160 characters or fewer.";
      aboutMeStatus.classList.add("error");
      return;
    }

    if (aboutMe === getAboutMe(activeProfileSettings)) {
      aboutMeStatus.textContent = "";
      return;
    }

    aboutMeStatus.classList.remove("error");
    aboutMeStatus.textContent = "Saving...";
    await writeProfileSettings({ aboutMe });
    if (activeUserId !== userId) {
      return;
    }

    callbacks.onAboutMeChange(aboutMe);
    if (aboutMeInput.value.trim() === aboutMe) {
      aboutMeStatus.textContent = "Saved";
      if (aboutMeStatusTimer !== null) {
        window.clearTimeout(aboutMeStatusTimer);
      }
      aboutMeStatusTimer = window.setTimeout(() => {
        aboutMeStatus.textContent = "";
        aboutMeStatusTimer = null;
      }, 1500);
    }
  }

  window.addEventListener("beforeunload", () => {
    subscription.unsubscribe();
  });
}
