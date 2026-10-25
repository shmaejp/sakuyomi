import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import type { Database } from "../../src/lib/database.types";
import { type SessionStore, watchSignedIn } from "../../src/session";
import { TestData } from "./support";

/** 端末の保存場所の代わり。 */
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
	return createClient<Database>(inject("supabaseUrl"), inject("anonKey"), {
		auth: {
			storageKey: store.key,
			storage: store.storage,
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
	});
}

describe("ログインしているか（サーバーに届くとき）", () => {
	const stops: (() => void)[] = [];
	let data: TestData | null = null;
	afterEach(async () => {
		for (const stop of stops.splice(0)) stop();
		await data?.cleanUp();
		data = null;
	});

	it("保存されたセッションの更新をサーバーが拒否したら、ログインしていないと知らせる", async () => {
		const store = storeWith({
			access_token: "expired-access-token",
			refresh_token: "revoked-refresh-token",
			token_type: "bearer",
			expires_in: 3600,
			expires_at: Math.floor(Date.now() / 1000) - 3600,
			user: { id: crypto.randomUUID(), aud: "authenticated" },
		});
		const seen: boolean[] = [];
		stops.push(watchSignedIn(clientWith(store), store, (s) => seen.push(s)));
		await vi.waitFor(() => expect(seen.at(-1)).toBe(false));
	});

	it("ログインしたら、ログイン中と知らせる", async () => {
		data = new TestData();
		const { email, password } = await data.user("session");
		const store = storeWith(null);
		const client = clientWith(store);
		const seen: boolean[] = [];
		stops.push(watchSignedIn(client, store, (s) => seen.push(s)));
		const { error } = await client.auth.signInWithPassword({ email, password });
		expect(error).toBeNull();
		await vi.waitFor(() => expect(seen.at(-1)).toBe(true));
	});
});
