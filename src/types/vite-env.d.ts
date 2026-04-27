// Ambient declaration for `import.meta.env` used by the auto-generated
// Supabase client (src/integrations/supabase/client.ts). This project is
// Next.js (which doesn't define ImportMeta.env), so we augment it here.

export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
    readonly VITE_SUPABASE_PROJECT_ID?: string;
    readonly [key: string]: string | undefined;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
