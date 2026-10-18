import type { TourStep } from "./Tour";

/**
 * Onboarding tour for the AI Workspace (BuilderV2).
 * Targets are matched via `data-tour` attributes on the relevant elements.
 * Mobile uses smaller / shorter labels — handled by the steps below.
 */
export const BUILDER_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to your AI Workspace",
    body: "Chat with the AI here to build a full app. Let's take a quick tour of 4 important things.",
    placement: "center",
  },
  {
    target: '[data-tour="chat-composer"]',
    title: "Chat with the AI",
    body: "Describe your app here — being specific like \"EMI calculator with monthly chart\" gets the best results.",
    placement: "top",
  },
  {
    target: '[data-tour="preview-tab"]',
    title: "Live preview",
    body: "See whatever the AI generates in real-time on this tab. Every change rebuilds instantly.",
    placement: "bottom",
  },
  {
    target: '[data-tour="ship-actions"]',
    title: "Brand & build APK",
    body: "Set your app name and icon, then download the APK / AAB to publish on Google Play.",
    placement: "bottom",
  },
  {
    title: "You're all set",
    body: "Stuck anytime? Visit the Help center (/help) or message support. Happy building!",
    placement: "center",
  },
];

export const BUILDER_TOUR_KEY = "tour:builder:v1";
