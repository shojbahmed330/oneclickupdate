import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Zap, Smartphone, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    icon: Sparkles,
    title: "Build with AI",
    body: "Describe your app in plain words. Our AI ships full code, design and database.",
  },
  {
    icon: Zap,
    title: "Live preview",
    body: "Every change rebuilds instantly. Tap to refine, swipe to compare versions.",
  },
  {
    icon: Smartphone,
    title: "Ship to Play Store",
    body: "Generate a real APK from your app. Push it to Google Play in minutes.",
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const finish = () => {
    haptic("success");
    localStorage.setItem("onboarded", "1");
    navigate("/auth", { replace: true });
  };
  const next = () => {
    haptic("selection");
    if (step < SLIDES.length - 1) setStep(step + 1);
    else finish();
  };
  const Slide = SLIDES[step];
  const Icon = Slide.icon;

  return (
    <MobileLayout>
      <div className="relative flex flex-col h-[100dvh] p-6 overflow-hidden">
        <div className="absolute inset-0 bg-editorial pointer-events-none" aria-hidden />
        <div className="relative flex justify-between items-center">
          <span className="font-display italic text-[15px] text-foreground/70 tracking-tight">
            {String(step + 1).padStart(2, "0")}
            <span className="text-foreground/30"> / {String(SLIDES.length).padStart(2, "0")}</span>
          </span>
          <button
            onClick={finish}
            className="text-sm text-muted-foreground active:scale-95 transition-transform px-3 py-1.5 -mr-2"
          >
            Skip
          </button>
        </div>
        <div key={step} className="relative flex-1 flex flex-col items-center justify-center text-center gap-6 animate-editorial-rise">
          <div className="h-24 w-24 rounded-3xl bg-primary/10 border border-primary/20 grid place-items-center shadow-editorial">
            <Icon className="h-12 w-12 text-primary" strokeWidth={1.4} />
          </div>
          <h1 className="font-display text-[44px] font-normal leading-[0.95] tracking-[-0.04em] max-w-[300px]">
            <span className="italic">{Slide.title.split(" ")[0]}</span>{" "}
            <span className="font-black">{Slide.title.split(" ").slice(1).join(" ")}</span>
          </h1>
          <p className="text-[15px] text-muted-foreground max-w-xs leading-relaxed">{Slide.body}</p>
        </div>
        <div className="relative flex items-center justify-center gap-2 mb-6">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i === step ? "w-8 bg-primary shadow-glow" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
        <Button
          size="lg"
          className="relative h-14 rounded-full text-[15px] font-semibold active:scale-[0.97] transition-transform shadow-editorial"
          onClick={next}
        >
          {step < SLIDES.length - 1 ? "Next" : "Get started"}
          <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      </div>
    </MobileLayout>
  );
}
