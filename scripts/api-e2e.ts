// End-to-end check of the vault REST API against a running server.
//
//   bun run scripts/api-e2e.ts            (defaults to http://localhost:8080)
//   BASE=http://192.168.1.42:3000 bun run scripts/api-e2e.ts
//
// It exercises the full contract: folders, nesting, PIN lock/unlock, upload,
// listing, download, rename, move, delete. Exits non-zero on the first failure.

const BASE = process.env["BASE"] ?? "http://localhost:8080";
const UNLOCK_HEADER = "x-vault-unlock";

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  tokens: string[] = [],
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(tokens.length ? { [UNLOCK_HEADER]: tokens.join(",") } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function main() {
  const stamp = Date.now();

  // --- folders ------------------------------------------------------------
  const parent = await call("POST", "/api/folders", { name: `E2E ${stamp}`, parentId: null });
  check("create folder", parent.status === 201 && !!parent.data.folder?.id, String(parent.status));
  const parentId: string = parent.data.folder.id;

  const child = await call("POST", "/api/folders", { name: "Nested", parentId });
  check("create nested folder", child.status === 201, String(child.status));
  const childId: string = child.data.folder.id;

  const listing = await call("GET", `/api/folders/${parentId}/files`);
  check(
    "nested folder appears in parent listing",
    listing.status === 200 && listing.data.folders.some((f: any) => f.id === childId),
  );
  check("breadcrumbs present", listing.data.breadcrumbs?.length === 1);

  const renamed = await call("PATCH", `/api/folders/${childId}`, { name: "Nested renamed" });
  check("rename folder", renamed.status === 200);

  // --- PIN protection -----------------------------------------------------
  const badPin = await call("POST", "/api/folders", { name: "Bad", parentId, pin: "12" });
  check("reject non-4-digit PIN", badPin.status === 400, String(badPin.status));

  const secure = await call("POST", "/api/folders", { name: "Private", parentId, pin: "2580" });
  check("create protected folder", secure.status === 201);
  const secureId: string = secure.data.folder.id;

  const lockedList = await call("GET", `/api/folders/${secureId}/files`);
  check("locked folder rejects listing", lockedList.status === 423, String(lockedList.status));

  const lockedUpload = await call("POST", "/api/files/upload", {
    folderId: secureId,
    name: "x.txt",
    size: 1,
    mimeType: "text/plain",
  });
  check("locked folder rejects upload", lockedUpload.status === 423, String(lockedUpload.status));

  const wrong = await call("POST", `/api/folders/${secureId}/unlock`, { pin: "1111" });
  check("wrong PIN rejected", wrong.status === 401, String(wrong.status));
  check("wrong PIN leaks no hash", !JSON.stringify(wrong.data).match(/hash|salt/i));

  const unlocked = await call("POST", `/api/folders/${secureId}/unlock`, { pin: "2580" });
  check("correct PIN unlocks", unlocked.status === 200 && !!unlocked.data.token);
  const token: string = unlocked.data.token;

  const openList = await call("GET", `/api/folders/${secureId}/files`, undefined, [token]);
  check("unlocked folder lists", openList.status === 200, String(openList.status));

  // --- upload -------------------------------------------------------------
  const payload = Buffer.from(`hello vault ${stamp}\n`.repeat(64));
  const ticket = await call(
    "POST",
    "/api/files/upload",
    { folderId: secureId, name: "../../evil name.txt", size: payload.length, mimeType: "text/plain" },
    [token],
  );
  check("upload ticket issued", ticket.status === 201 && !!ticket.data.url, String(ticket.status));
  const fileId: string = ticket.data.fileId;

  const put = await fetch(`${BASE}${ticket.data.url}`, {
    method: ticket.data.method,
    headers: ticket.data.headers,
    body: payload,
  });
  check("file body streamed to storage", put.ok, String(put.status));

  const completed = await call(
    "POST",
    `/api/files/${fileId}/complete`,
    { size: payload.length },
    [token],
  );
  check("upload completed", completed.status === 200, String(completed.status));
  check(
    "filename sanitised (no traversal)",
    !completed.data.file.name.includes("/") && !completed.data.file.name.includes(".."),
    completed.data.file?.name,
  );

  const afterUpload = await call("GET", `/api/folders/${secureId}/files`, undefined, [token]);
  check(
    "file appears in listing",
    afterUpload.data.files?.some((f: any) => f.id === fileId),
  );

  // --- download -----------------------------------------------------------
  const dl = await call("GET", `/api/files/${fileId}/download`, undefined, [token]);
  check("download link issued", dl.status === 200 && !!dl.data.url);
  const body = await fetch(`${BASE}${dl.data.url}`);
  const bytes = Buffer.from(await body.arrayBuffer());
  check("downloaded bytes match upload", bytes.equals(payload), `${bytes.length}/${payload.length}`);

  // --- rename / move / search --------------------------------------------
  const renameFile = await call("PATCH", `/api/files/${fileId}`, { name: "renamed.txt" }, [token]);
  check("rename file", renameFile.status === 200);

  const search = await call("GET", `/api/files/search?q=renamed`, undefined, [token]);
  check("search finds the file", search.data.files?.some((f: any) => f.id === fileId));

  const moved = await call("POST", `/api/files/${fileId}/move`, { folderId: childId }, [token]);
  check("move file to nested folder", moved.status === 200, String(moved.status));

  const nested = await call("GET", `/api/folders/${childId}/files`);
  check(
    "moved file readable in unprotected nested folder",
    nested.data.files?.some((f: any) => f.id === fileId),
  );

  // --- lock again ---------------------------------------------------------
  const relocked = await call("POST", `/api/folders/${secureId}/lock`, {});
  check("lock folder", relocked.status === 200);
  const afterLock = await call("GET", `/api/folders/${secureId}/files`, undefined, [token]);
  check("old ticket no longer works", afterLock.status === 423, String(afterLock.status));

  // --- errors -------------------------------------------------------------
  const missing = await call("GET", "/api/files/00000000-0000-4000-8000-000000000000/download");
  check("missing file returns 404", missing.status === 404, String(missing.status));
  const badId = await call("GET", "/api/files/not-a-uuid/download");
  check("invalid id returns 400", badId.status === 400, String(badId.status));

  // --- delete -------------------------------------------------------------
  const delFile = await call("DELETE", `/api/files/${fileId}`);
  check("delete file", delFile.status === 200, String(delFile.status));
  const delTree = await call("DELETE", `/api/folders/${parentId}`);
  check("delete folder tree", delTree.status === 200, String(delTree.status));
  const gone = await call("GET", `/api/folders/${parentId}/files`);
  check("deleted folder returns 404", gone.status === 404, String(gone.status));

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
