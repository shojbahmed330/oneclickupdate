// DEPRECATED — legacy v1/v2 agent toggle removed.
// New backend (Claude Agent SDK + Daytona) replaces both versions.
// This stub exists only until the builder UI is rewritten in a follow-up turn.

export function useAgentVersion() {
  return {
    isAdmin: false,
    preferV2: false,
    loading: false,
    setPreference: async (_useV2: boolean) => {
      // no-op
    },
  };
}

export function getAgentVersionCached(): { isAdmin: boolean; preferV2: boolean } {
  return { isAdmin: false, preferV2: false };
}

export async function warmAgentVersionCache(): Promise<void> {
  // no-op
}
