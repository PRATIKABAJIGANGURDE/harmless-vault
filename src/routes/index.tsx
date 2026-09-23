import { createFileRoute } from "@tanstack/react-router";

import { VaultBrowser } from "@/components/vault/VaultBrowser";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Harmless Vault — private file storage with PIN-locked folders" },
      {
        name: "description",
        content:
          "Store files in a private vault with nested folders, 4-digit PIN locks, drag-and-drop uploads and instant downloads.",
      },
      { property: "og:title", content: "Harmless Vault" },
      {
        property: "og:description",
        content: "Private file storage with nested, PIN-locked folders and streaming uploads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <VaultBrowser folderId={null} />,
});
