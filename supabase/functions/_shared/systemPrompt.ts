// Backwards-compat re-export. The prompt now lives in systemPromptLayers.ts
// split into CORE + conditional layers. Importers that still want the full
// monolithic string get FULL_SYSTEM_PROMPT under the old name.
export { FULL_SYSTEM_PROMPT as SYSTEM_PROMPT } from "./systemPromptLayers.ts";
