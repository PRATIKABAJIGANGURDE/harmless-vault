import { createFileRoute, useParams } from "@tanstack/react-router";

import { VaultBrowser } from "@/components/vault/VaultBrowser";

export const Route = createFileRoute("/f/$folderId")({
  head: () => ({
    meta: [
      { title: "Folder — Harmless Vault" },
      {
        name: "description",
        content: "Browse a folder in your vault: nested folders, files, uploads and downloads.",
      },
      { property: "og:title", content: "Folder — Harmless Vault" },
      {
        property: "og:description",
        content: "Browse a folder in your vault: nested folders, files, uploads and downloads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FolderRoute,
});

function FolderRoute() {
  const { folderId } = useParams({ from: "/f/$folderId" });
  return <VaultBrowser key={folderId} folderId={folderId} />;
}
