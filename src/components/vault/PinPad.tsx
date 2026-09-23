import { Delete, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface PinPadProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  onSubmit: (pin: string) => void;
  onOpenChange: (open: boolean) => void;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

export function PinPad({
  open,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onSubmit,
  onOpenChange,
}: PinPadProps) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (open) setPin("");
  }, [open]);

  useEffect(() => {
    if (error) setPin("");
  }, [error]);

  const press = (key: string) => {
    if (pending) return;
    if (key === "del") return setPin((p) => p.slice(0, -1));
    if (!key) return;
    setPin((p) => (p.length >= 4 ? p : p + key));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key);
      if (event.key === "Backspace") press("del");
      if (event.key === "Enter" && pin.length === 4) onSubmit(pin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel max-w-sm border-border/70">
        <DialogHeader className="items-center text-center">
          <div className="animate-pulse-ring mb-2 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock className="size-5" />
          </div>
          <DialogTitle className="text-display text-xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className={cn("flex justify-center gap-3 py-2", error && "animate-shake")}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "size-3.5 rounded-full border transition-all duration-200",
                i < pin.length
                  ? "scale-110 border-primary bg-primary shadow-[0_0_14px_var(--primary)]"
                  : "border-border bg-muted",
              )}
            />
          ))}
        </div>

        {error ? (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key, index) =>
            key === "" ? (
              <span key={index} />
            ) : (
              <button
                key={index}
                type="button"
                onClick={() => press(key)}
                disabled={pending}
                aria-label={key === "del" ? "Delete last digit" : key}
                className="flex h-14 items-center justify-center rounded-xl border border-border/70 bg-secondary/40 text-lg font-medium transition-all hover:border-primary/60 hover:bg-secondary active:scale-95 disabled:opacity-50"
              >
                {key === "del" ? <Delete className="size-5" /> : key}
              </button>
            ),
          )}
        </div>

        <Button
          className="mt-2 h-11 w-full"
          disabled={pin.length !== 4 || pending}
          onClick={() => onSubmit(pin)}
        >
          {pending ? "Checking…" : confirmLabel}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
