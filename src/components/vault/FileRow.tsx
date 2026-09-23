import {
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  MoreVertical,
  PencilLine,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes } from "@/lib/utils";
import type { VaultFile } from "@/lib/vault/types";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.includes("zip") || mime.includes("compressed")) return FileArchive;
  return FileText;
}

interface FileRowProps {
  file: VaultFile;
  index: number;
  busy?: boolean;
  onDownload: (file: VaultFile) => void;
  onRename: (file: VaultFile) => void;
  onDelete: (file: VaultFile) => void;
}

export function FileRow({ file, index, busy, onDownload, onRename, onDelete }: FileRowProps) {
  const Icon = iconFor(file.mimeType);
  return (
    <div
      className="animate-rise group flex items-center gap-4 rounded-xl border border-border/60 bg-surface/50 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-surface"
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary/60 text-muted-foreground group-hover:text-primary">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDownload(file)}
        disabled={busy}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary disabled:opacity-50"
        aria-label={`Download ${file.name}`}
      >
        <Download className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={`Actions for ${file.name}`}
        >
          <MoreVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRename(file)}>
            <PencilLine className="mr-2 size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(file)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
