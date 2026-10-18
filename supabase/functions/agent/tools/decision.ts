// Decision-layer tools:
//   • ask_clarification          — emit a multiple-choice question card to the user
//   • propose_design_directions  — emit 2-3 design prototype options before coding
//
// Both tools are *terminal* for the turn: their job is to surface a UI card
// in the chat and stop. The agent should NOT continue with edits in the same
// turn — it should wait for the user to pick. We enforce this in the prompt
// (LAYER_DECISION) and via a clear `next: "wait_for_user"` field in the
// output so the UI can render properly.
import { tool } from "npm:ai@5.0.26";
import { z } from "npm:zod@3.23.8";
import type { DaytonaSandbox } from "../../_shared/daytona.ts";
import type { ToolCtx } from "../shared.ts";

export function makeDecisionTools(_sandbox: DaytonaSandbox, _ctx: ToolCtx, _cwd: string) {
  return {
    ask_clarification: tool({
      description:
        "Ask the user ONE multiple-choice question to resolve ambiguity BEFORE doing any work. " +
        "Use only when the request is genuinely unclear (vague scope, missing key requirement). " +
        "After calling, STOP — do not edit files or call other tools. The UI renders the choices " +
        "as a card; the user's reply will come in the next turn. Do not use for trivial assumptions.",
      inputSchema: z.object({
        question: z.string().min(4).max(200).describe("The single question, in the user's language."),
        options: z.array(z.object({
          label: z.string().min(1).max(60).describe("Short choice label shown on the button."),
          description: z.string().max(140).optional().describe("Optional 1-line clarification of trade-off."),
        })).min(2).max(4).describe("2-4 distinct choices. Keep them short and mutually exclusive."),
        allow_other: z.boolean().default(true).describe("Show a free-text 'Other' option."),
      }),
      execute: async ({ question, options, allow_other }) => {
        return {
          ok: true,
          kind: "clarification",
          question,
          options,
          allow_other,
          next: "wait_for_user",
          hint: "Card rendered. End this turn now — wait for user to reply.",
        };
      },
    }),

    propose_design_directions: tool({
      description:
        "Propose 2-3 design directions for a visual change BEFORE editing the UI. " +
        "Use ONLY for qualitative visual requests ('make it nicer', 'improve hero', 'modern look'). " +
        "Skip for exact tweaks ('change color to #111'). Each direction is a short style description — " +
        "the UI shows them as cards and the user picks one. STOP after calling; wait for user pick.",
      inputSchema: z.object({
        target: z.string().min(2).max(120).describe("What is being redesigned (e.g. 'hero section', 'pricing card')."),
        directions: z.array(z.object({
          id: z.string().min(1).max(20).describe("Short id like 'minimal', 'bold', 'editorial'."),
          name: z.string().min(2).max(40).describe("Short name shown on the card."),
          summary: z.string().min(8).max(200).describe("1-2 line description of the visual approach."),
          accent: z.string().max(40).optional().describe("Optional accent color/keyword for the preview chip."),
        })).min(2).max(3),
      }),
      execute: async ({ target, directions }) => {
        return {
          ok: true,
          kind: "design_directions",
          target,
          directions,
          next: "wait_for_user",
          hint: "Card rendered. End this turn now — wait for user to pick a direction.",
        };
      },
    }),
  };
}
