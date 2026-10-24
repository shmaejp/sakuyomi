import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type Client = SupabaseClient<Database>;

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
	throw new Error(
		"VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を .env.local に設定してください（.env.example を参照）",
	);
}

// セッションは端末に保存し、期限が切れる前に自動で更新する。畑でログインし直さなくて済むようにするため。
export const supabase: Client = createClient<Database>(url, anonKey, {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
	},
});
