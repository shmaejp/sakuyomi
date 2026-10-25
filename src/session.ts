import type { Client } from "./lib/supabase";

/** 端末にセッションを保存する場所。Supabase のクライアントとログインの判定に、同じものを渡す。 */
export type SessionStore = {
	storage: {
		getItem(key: string): string | null;
		setItem(key: string, value: string): void;
		removeItem(key: string): void;
	};
	key: string;
};

/**
 * ログインしているかを知らせ続ける。止めるときは返した関数を呼ぶ。
 *
 * 最初は、端末にセッションが保存されているかだけで決めて、すぐに知らせる。
 * Supabase の getSession は、アクセストークンの期限が切れていると更新を試み、圏外では 30 秒ほど再試行したうえで
 * セッションなしを返す。それを待つと、圏外で開いたときに記録の画面が出ないため。
 * その後は、ログインした・ログアウトした（更新がサーバーに拒否されたときも含む）ときだけ知らせ直す。
 */
export function watchSignedIn(
	client: Client,
	store: SessionStore,
	onChange: (signedIn: boolean) => void,
): () => void {
	onChange(store.storage.getItem(store.key) !== null);
	const { data } = client.auth.onAuthStateChange((event) => {
		if (event === "SIGNED_IN") onChange(true);
		if (event === "SIGNED_OUT") onChange(false);
	});
	return () => data.subscription.unsubscribe();
}
