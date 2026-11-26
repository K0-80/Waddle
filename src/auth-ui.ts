import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "./supabase";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

interface AuthenticatedUser {
  id: string;
  username: string;
}

interface AuthUiCallbacks {
  onAuthenticated: (
    client: SupabaseClient,
    user: AuthenticatedUser,
  ) => void;
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

  const showSignedOutUi = (): void => {
    latestSessionUserId = null;
    activeUserId = null;
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
        .select("username")
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
      panel.hidden = true;
      sessionBar.hidden = false;
      sessionName.textContent = profile.username;
      showStatus("");
      callbacks.onAuthenticated(client, {
        id: session.user.id,
        username: profile.username,
      });
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

  window.addEventListener("beforeunload", () => {
    subscription.unsubscribe();
  });
}
