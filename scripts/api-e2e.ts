const BASE = "http://localhost:8080";
let token = "";
const results: string[] = [];
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

async function call(method: string, path: string, body?: unknown, useToken = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(useToken && token ? { "x-vault-unlock": token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const run = async () => {
  // 1. create folder
  const a = await call("POST", "/api/folders", { name: "E2E Run", parentId: null });
  check("create folder", a.status === 201 && !!a.json.folder?.id, `status ${a.status}`);
  const rootId = a.json.folder.id as string;

  // 2. nested folder
  const b = await call("POST", "/api/folders", { name: "Nested", parentId: rootId });
  check("create nested folder", b.status === 201 && b.json.folder.parentId === rootId);
  const nestedId = b.json.folder.id as string;

  // 3. protected folder
  const c = await call("POST", "/api/folders", { name: "E2E Locked", parentId: rootId, pin: "2580" });
  check("create protected folder", c.status === 201 && c.json.folder.isProtected === true);
  const lockedId = c.json.folder.id as string;

  // 3b. bad pin rejected at creation
  const badPin = await call("POST", "/api/folders", { name: "Bad", parentId: rootId, pin: "12" });
  check("reject non 4-digit PIN", badPin.status === 400, `status ${badPin.status}`);

  // 4. locked listing rejected
  const l1 = await call("GET", `/api/folders/${lockedId}/files`);
  check("locked folder listing rejected (423)", l1.status === 423 && l1.json.error.code === "FOLDER_LOCKED", `status ${l1.status}`);

  // 5. upload into locked folder rejected
  const l2 = await call("POST", "/api/files/upload", { folderId: lockedId, name: "x.txt", size: 3, mimeType: "text/plain" });
  check("locked folder upload rejected (423)", l2.status === 423, `status ${l2.status}`);

  // 6. wrong pin
  const w = await call("POST", `/api/folders/${lockedId}/unlock`, { pin: "1111" });
  check("wrong PIN rejected (401)", w.status === 401 && w.json.error.code === "INVALID_PIN", `status ${w.status}`);
  check("wrong PIN leaks nothing", JSON.stringify(w.json).match(/hash|salt|2580/) === null);

  // 7. correct pin
  const u = await call("POST", `/api/folders/${lockedId}/unlock`, { pin: "2580" });
  check("correct PIN unlocks", u.status === 200 && typeof u.json.token === "string", `status ${u.status}`);
  token = u.json.token;

  // 8. listing now allowed
  const l3 = await call("GET", `/api/folders/${lockedId}/files`);
  check("unlocked folder lists", l3.status === 200 && Array.isArray(l3.json.files), `status ${l3.status}`);

  // 9. upload
  const payload = new TextEncoder().encode("harmless vault e2e payload ".repeat(40));
  const t = await call("POST", "/api/files/upload", {
    folderId: lockedId, name: "../../evil report.txt", size: payload.byteLength, mimeType: "text/plain",
  });
  check("upload ticket issued", t.status === 201 && !!t.json.url, `status ${t.status}`);
  const fileId = t.json.fileId as string;
  const put = await fetch(t.json.url, { method: t.json.method, headers: t.json.headers, body: payload });
  check("body streamed to storage", put.ok, `status ${put.status}`);
  const done = await call("POST", `/api/files/${fileId}/complete`, { size: payload.byteLength });
  check("upload completed", done.status === 200, `status ${done.status}`);
  check("filename sanitised", !String(done.json.file.name).includes("..") && !String(done.json.file.name).includes("/"), done.json.file?.name);

  // 10. listing shows it
  const l4 = await call("GET", `/api/folders/${lockedId}/files`);
  check("file appears in listing", l4.json.files.some((f: any) => f.id === fileId));
  check("file metadata present", l4.json.files[0].size === payload.byteLength && l4.json.files[0].mimeType === "text/plain");

  // 11. download
  const d = await call("GET", `/api/files/${fileId}/download`);
  check("download url issued", d.status === 200 && !!d.json.url);
  const bytes = new Uint8Array(await (await fetch(d.json.url)).arrayBuffer());
  check("downloaded bytes match", bytes.byteLength === payload.byteLength);

  // 12. rename
  const r = await call("PATCH", `/api/files/${fileId}`, { name: "renamed report.txt" });
  check("rename file", r.status === 200 && r.json.name === "renamed report.txt", `status ${r.status}`);

  // 13. search
  const s = await call("GET", "/api/files/search?q=renamed");
  check("search finds file", s.status === 200 && s.json.files.some((f: any) => f.id === fileId));

  // 14. move to nested (unprotected) folder
  const m = await call("POST", `/api/files/${fileId}/move`, { folderId: nestedId });
  check("move file", m.status === 200, `status ${m.status}`);
  const l5 = await call("GET", `/api/folders/${nestedId}/files`);
  check("file is in destination", l5.json.files.some((f: any) => f.id === fileId));

  // 15. nested folder access still works while parent unprotected
  const l6 = await call("GET", `/api/folders/${nestedId}/files`, undefined, false);
  check("unprotected nested folder readable without ticket", l6.status === 200);

  // 16. lock again
  const lock = await call("POST", `/api/folders/${lockedId}/lock`);
  check("lock folder", lock.status === 200);
  const l7 = await call("GET", `/api/folders/${lockedId}/files`);
  check("relocked folder rejects listing", l7.status === 423, `status ${l7.status}`);

  // 17. invalid ids / missing file
  const nf = await call("GET", `/api/files/3f2504e0-4f89-41d3-9a0c-0305e82c3301/download`);
  check("missing file → 404", nf.status === 404, `status ${nf.status}`);
  const bad = await call("GET", `/api/files/not-a-uuid/download`);
  check("invalid id → 400", bad.status === 400, `status ${bad.status}`);

  // 18. rate limiting
  let limited = false;
  for (let i = 0; i < 8; i++) {
    const res = await call("POST", `/api/folders/${lockedId}/unlock`, { pin: "0000" });
    if (res.status === 429) { limited = true; break; }
  }
  check("unlock rate limiting kicks in (429)", limited);

  // 19. delete file + cleanup
  token = (await call("POST", `/api/folders/${lockedId}/unlock`, { pin: "2580" })).json.token ?? token;
  const del = await call("DELETE", `/api/files/${fileId}`);
  check("delete file", del.status === 200, `status ${del.status}`);
  const cleanup = await call("DELETE", `/api/folders/${rootId}`);
  check("delete folder tree", cleanup.status === 200, `status ${cleanup.status}`);
  const gone = await call("GET", `/api/folders/${rootId}/files`);
  check("deleted folder → 404", gone.status === 404, `status ${gone.status}`);
};

run()
  .catch((e) => { check("run completed", false, String(e)); })
  .finally(() => {
    console.log(results.join("\n"));
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });
