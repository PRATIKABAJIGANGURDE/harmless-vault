ALTER TABLE public.files ADD COLUMN IF NOT EXISTS original_name text;
UPDATE public.files SET original_name = name WHERE original_name IS NULL;
ALTER TABLE public.files ALTER COLUMN original_name SET DEFAULT '';
ALTER TABLE public.files ALTER COLUMN original_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS files_folder_id_idx ON public.files (folder_id);
CREATE INDEX IF NOT EXISTS files_status_idx ON public.files (status);
CREATE INDEX IF NOT EXISTS files_name_idx ON public.files (lower(name));
CREATE INDEX IF NOT EXISTS folders_parent_id_idx ON public.folders (parent_id);
CREATE INDEX IF NOT EXISTS folders_name_idx ON public.folders (lower(name));
CREATE INDEX IF NOT EXISTS folder_unlock_sessions_folder_id_idx ON public.folder_unlock_sessions (folder_id);
CREATE INDEX IF NOT EXISTS folder_unlock_sessions_expires_at_idx ON public.folder_unlock_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.folder_unlock_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  client_key text NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.folder_unlock_attempts TO service_role;
ALTER TABLE public.folder_unlock_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS folder_unlock_attempts_lookup_idx
  ON public.folder_unlock_attempts (folder_id, client_key, created_at DESC);