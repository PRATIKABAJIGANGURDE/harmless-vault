import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";

import { cn, formatBytes } from "@/lib/utils";

export interface QueueItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  abort?: () => void;
}

export function UploadQueue({
  items,
  onDismiss,
  onClear,
}: {
  items: QueueItem[];
  onDismiss: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const active = items.filter((i) => i.status === "uploading").length;

  return (
    <div className="animate-rise panel fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-display text-sm font-semibold">
          {active > 0 ? `Uploading ${active} file${active === 1 ? "" : "s"}` : "Uploads"}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear
        </button>
      </div>
      <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
        {items.map((item) => (
          <div key={item.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              {item.status === "uploading" ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              ) : item.status === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-primary" />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
              <span className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
              <button
                type="button"
                onClick={() => {
                  item.abort?.();
                  onDismiss(item.id);
                }}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Dismiss ${item.name}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="sweep-line h-1.5 w-full rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  item.status === "error" ? "bg-destructive" : "bg-primary",
                )}
                style={{ width: `${item.status === "done" ? 100 : item.progress}%` }}
              />
            </div>
            {item.error ? <p className="text-[11px] text-destructive">{item.error}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
