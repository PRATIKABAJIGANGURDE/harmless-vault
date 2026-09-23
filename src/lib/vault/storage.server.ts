// Storage abstraction.
//
// Everything in the app talks to `StorageService` only. Swapping Lovable Cloud
// storage for the Narzo 50A (Node.js/Termux) later means adding one more
// implementation of this interface and changing `getStorageService()` — no
// changes in the UI or in the database layer.
//
// Large files never pass through the app server or browser memory: the client
// receives a pre-signed URL and streams the file body straight to storage.

export interface UploadTicket {
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
}

export interface StorageService {
  /** A short-lived, write-only URL the browser can stream a file body to. */
  createUploadTicket(key: string, mimeType: string): Promise<UploadTicket>;
  /** A short-lived, read-only URL the browser can stream a file body from. */
  createDownloadUrl(key: string, fileName: string): Promise<string>;
  /** Removes objects. Missing objects are not an error. */
  remove(keys: string[]): Promise<void>;
}

class SupabaseStorageService implements StorageService {
  private bucket = "vault";

  private async client() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin.storage.from(this.bucket);
  }

  async createUploadTicket(key: string, mimeType: string): Promise<UploadTicket> {
    const storage = await this.client();
    const { data, error } = await storage.createSignedUploadUrl(key, { upsert: true });
    if (error || !data) throw new Error(error?.message ?? "Could not start the upload.");
    return {
      url: data.signedUrl,
      method: "PUT",

      headers: {
        "x-upsert": "true",
        ...(mimeType ? { "content-type": mimeType } : {}),
      },
    };
  }

  async createDownloadUrl(key: string, fileName: string): Promise<string> {
    const storage = await this.client();
    const { data, error } = await storage.createSignedUrl(key, 300, { download: fileName });
    if (error || !data) throw new Error(error?.message ?? "Could not prepare the download.");
    return data.signedUrl;
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const storage = await this.client();
    const { error } = await storage.remove(keys);
    if (error) throw new Error(error.message);
  }
}

let instance: StorageService | null = null;

export function getStorageService(): StorageService {
  // Future: read an env flag here and return a NarzoStorageService instead.
  if (!instance) instance = new SupabaseStorageService();
  return instance;
}
