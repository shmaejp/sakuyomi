import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "./lib/database.types";
import { type SessionStore, watchSignedIn } from "./session";

/** 何も待ち受けていないポート。圏外と同じく、通信が失敗する。 */
const UNREACHABLE_URL = "http://127.0.0.1:9";

/** 端末の保存場所の代わり。stored があれば、セッションが保存されている。 */
function storeWith(stored: object | null): SessionStore {
	const items = new Map<string, string>();
	const key = "sakuyomi-test-auth-token";
	if (stored) items.set(key, JSON.stringify(stored));
	return {
		key,
		storage: {
			getItem: (k) => items.get(k) ?? null,
			setItem: (k, value) => void items.set(k, value),
			removeItem: (k) => void items.delete(k),
		},
	};
}

function clientWith(store: SessionStore) {
	return createClient<Database>(UNREACHABLE_URL, "anon-key", {
		auth: {
			storageKey: store.key,
			storage: store.storage,
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
	});
}

/** 1 時間前にアクセストークンの期限が切れたセッション。 */
function expiredSession() {
	return {
		access_token: "expired-access-token",
		refresh_token: "refresh-token",
		token_type: "bearer",
		expires_in: 3600,
		expires_at: Math.floor(Date.now() / 1000) - 3600,
		user: { id: crypto.randomUUID(), aud: "authenticated" },
	};
}

/** 終わっていれば true。終わっていなければ、待たずに false。 */
async function settled(promise: Promise<unknown>) {
	const pending = Symbol();
	return (await Promise.race([promise, Promise.resolve(pending)])) !== pending;
}

describe("ログインしているか", () => {
	const stops: (() => void)[] = [];
	afterEach(() => {
		for (const stop of stops.splice(0)) stop();
	});

	function watch(store: SessionStore) {
		const seen: boolean[] = [];
		stops.push(
			watchSignedIn(clientWith(store), store, (signedIn) =>
				seen.push(signedIn),
			),
		);
		return seen;
	}

	it("アクセストークンの期限が切れていても、圏外で更新できないだけならすぐにログイン中と知らせる", async () => {
		const store = storeWith(expiredSession());
		const client = clientWith(store);
		const seen: boolean[] = [];
		stops.push(watchSignedIn(client, store, (s) => seen.push(s)));
		expect(seen).toEqual([true]);
		// supabase-js は更新を 30 秒ほど再試行してから、セッションなしを返す。あきらめた後も、ログアウトしたことにはしない。
		vi.useFakeTimers({ toFake: ["setTimeout"] });
		const loading = client.auth.getSession();
		while (!(await settled(loading))) await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();
		expect((await loading).data.session).toBeNull();
		expect(seen).toEqual([true]);
	});

	it("セッションが保存されていなければ、ログインしていないと知らせる", async () => {
		const seen = watch(storeWith(null));
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(seen.at(-1)).toBe(false);
		expect(seen).not.toContain(true);
	});
});
