// Template registry.
//
// ⚠️ Only the e-commerce template has a real deterministic scaffold
// (supabase/functions/_shared/scaffolds/ecommerce). The other 18 starter
// templates we used to ship were prompt-only stubs — they pasted a long
// text into the input box and nothing else. They were removed to stop
// users from getting the impression that those templates produce a
// pre-built app. The Dashboard now shows an empty TEMPLATES list, so the
// Templates gallery just shows the empty state.
//
// E-commerce template is kept in the repo (used by templateMatcher.ts +
// runAgent.ts to trigger the real ecommerce scaffold when the user TYPES
// an e-commerce prompt), but it is NOT exposed in the gallery — leave it
// commented out below so it never gets pasted as a starter prompt either.

import type { Template } from "./types";
// import { ecommerceTemplate } from "./ecommerce"; // kept for scaffold-matcher only

export type { Template } from "./types";

export const TEMPLATES: Template[] = [
  // ecommerceTemplate, // ⛔ intentionally hidden from gallery — see note above
];
