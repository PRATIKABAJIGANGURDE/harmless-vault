# Secure Vault

Continue the existing Harmless Vault project. Keep the current UI/design and do NOT redesign it. Now implement the real application data/API layer and working product behavior. Build a clean API/data abstraction for: folders, nested folders using parent_id, files, 4-digit PIN-protected folders, secure folder unlock sessions, upload, download, delete, rename, file metadata, and folder/file counts. PINs must never be stored as plaintext; hash them server-side and verify them securely. Locked folders must reject file listing, upload, download, rename and delete requests until unlocked. Do not use fake/mock data. Keep file storage abstracted behind a storage service/interface because the eventual production storage will be the user's Narzo 50A running Node.js/Termux. Keep the frontend API-driven so the storage backend can later be switched from Lovable/cloud storage to the Narzo 50A without rebuilding the UI. Add proper loading, error and empty states. Do not add arbitrary application file-size limits; use streaming/storage mechanisms appropriate for large files rather than loading entire files into browser memory. Do not expose secrets in frontend code. Preserve the current premium dark UI, upload animations, drag/drop, progress/queue, folder cards and PIN modal. After implementation, verify the complete flow: create Private folder with PIN 2580, lock it, confirm access is rejected while locked, unlock it, upload a file, list it, download it, delete it, and lock it again. Do not invent successful test results; report any implementation limitations or remaining issues.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/69eb11cc-86d4-4c96-8d3e-475021d31c12).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
