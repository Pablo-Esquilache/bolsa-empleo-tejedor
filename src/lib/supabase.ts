import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const isSupabaseConfigured =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY) &&
  import.meta.env.VITE_SUPABASE_URL !== 'https://tu-proyecto.supabase.co';

export const SESSION_INVALID_EVENT = 'bolsa_tejedor:session_invalid';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

const originalRpc = supabase.rpc.bind(supabase);
(supabase as any).rpc = (fn: string, args?: any, options?: any) => {
  const builder = originalRpc(fn, args, options);
  const originalThen = builder.then.bind(builder);
  builder.then = (onfulfilled?: any, onrejected?: any) => {
    return originalThen((result: any) => {
      const errMsg = String(result?.error?.message || '');
      if (
        fn !== 'logout_user_session' &&
        /sesi[oó]n inv[aá]lida/i.test(errMsg) &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(new CustomEvent(SESSION_INVALID_EVENT));
      }
      return onfulfilled ? onfulfilled(result) : result;
    }, onrejected);
  };
  return builder;
};
