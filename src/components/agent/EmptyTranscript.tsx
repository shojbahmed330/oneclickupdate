import logoMark from "@/assets/oneclick-mark.webp";

export const EmptyTranscript = () => {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <img
        src={logoMark}
        alt="OneClick Studio"
        width={32}
        height={32}
        className="mb-3 h-8 w-8 rounded-full object-contain drop-shadow-[0_2px_8px_hsl(var(--primary)/0.45)]"
      />
      <h2 className="text-lg font-semibold text-foreground">What do you want to build?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Type below — I'll build it for you.
      </p>
    </div>
  );
};
