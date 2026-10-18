import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Global UI / user-preference store (Zustand).
 *
 * Use this for client-only state that survives reloads but isn't server-owned:
 *   - haptics on/off
 *   - default chat mode (agent vs ask)
 *   - builder layout (mobile vs desktop split sizes)
 *   - theme echo (the canonical theme lives in ThemeProvider, this just mirrors)
 *
 * For SERVER state (projects, messages, profile, credits) use TanStack Query.
 * For AUTH state, useAuth() (Context wrapping supabase.auth) is canonical.
 */
type ChatMode = "agent" | "ask";

interface PreferencesState {
  hapticsEnabled: boolean;
  defaultChatMode: ChatMode;
  builderChatPaneSize: number; // % of viewport
  onboarded: boolean;
  setHapticsEnabled: (v: boolean) => void;
  setDefaultChatMode: (m: ChatMode) => void;
  setBuilderChatPaneSize: (n: number) => void;
  markOnboarded: () => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      hapticsEnabled: true,
      defaultChatMode: "agent",
      builderChatPaneSize: 38,
      onboarded: false,
      setHapticsEnabled: (v) => set({ hapticsEnabled: v }),
      setDefaultChatMode: (m) => set({ defaultChatMode: m }),
      setBuilderChatPaneSize: (n) => set({ builderChatPaneSize: n }),
      markOnboarded: () => set({ onboarded: true }),
    }),
    { name: "oneclick-studio.preferences" },
  ),
);
