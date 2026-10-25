import { createClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import type { Database } from "../../src/lib/database.types";
import type { Client } from "../../src/lib/supabase";

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** RLS を通らない管理用のクライアント。テストのデータを用意・片付けるためだけに使う。 */
export function adminClient(): Client {
	return createClient<Database>(
		inject("supabaseUrl"),
		inject("serviceRoleKey"),
		options,
	);
}

/** ログインしていない人のクライアント。 */
export function anonClient(): Client {
	return createClient<Database>(
		inject("supabaseUrl"),
		inject("anonKey"),
		options,
	);
}

/**
 * テストごとに農場やユーザーを作り、終わったら片付ける。
 * 他のテストのデータと混ざらないよう、名前とメールアドレスには毎回別の接尾辞を付ける。
 */
export class TestData {
	private readonly admin = adminClient();
	private readonly suffix = crypto.randomUUID().slice(0, 8);
	private readonly farmIds: string[] = [];
	private readonly userIds: string[] = [];

	async farm(name: string): Promise<string> {
		const { data, error } = await this.admin
			.from("farms")
			.insert({ name: `${name}-${this.suffix}` })
			.select("id")
			.single();
		if (error) throw error;
		this.farmIds.push(data.id);
		return data.id;
	}

	/** アカウントを作り、ログインしたクライアントを返す（農場にはまだ属さない）。 */
	async user(
		label: string,
	): Promise<{ userId: string; client: Client; accessToken: string }> {
		const email = `${label}-${this.suffix}@example.com`;
		const password = `pw-${crypto.randomUUID()}`;
		const { data, error } = await this.admin.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
		});
		if (error) throw error;
		this.userIds.push(data.user.id);

		const client = anonClient();
		const signIn = await client.auth.signInWithPassword({ email, password });
		if (signIn.error) throw signIn.error;
		return {
			userId: data.user.id,
			client,
			accessToken: signIn.data.session.access_token,
		};
	}

	async member(
		farmId: string,
		values: {
			userId?: string;
			displayName: string;
			spokenNames?: string[];
			leftAt?: string;
		},
	): Promise<string> {
		const { data, error } = await this.admin
			.from("farm_members")
			.insert({
				farm_id: farmId,
				user_id: values.userId ?? null,
				display_name: values.displayName,
				spoken_names: values.spokenNames ?? [],
				left_at: values.leftAt ?? null,
			})
			.select("id")
			.single();
		if (error) throw error;
		return data.id;
	}

	async field(
		farmId: string,
		values: { name: string; spokenNames?: string[]; retiredAt?: string },
	): Promise<string> {
		const { data, error } = await this.admin
			.from("fields")
			.insert({
				farm_id: farmId,
				name: values.name,
				spoken_names: values.spokenNames ?? [],
				retired_at: values.retiredAt ?? null,
			})
			.select("id")
			.single();
		if (error) throw error;
		return data.id;
	}

	async crop(
		farmId: string,
		values: { name: string; spokenNames?: string[] },
	): Promise<string> {
		const { data, error } = await this.admin
			.from("crops")
			.insert({
				farm_id: farmId,
				name: values.name,
				spoken_names: values.spokenNames ?? [],
			})
			.select("id")
			.single();
		if (error) throw error;
		return data.id;
	}

	async cleanUp() {
		// 記録を消すと、版・取り出し・結びつきも消える。正本はストレージから別に消す。
		const { data: records } = await this.admin
			.from("records")
			.select("audio_path")
			.in("farm_id", this.farmIds);
		const paths = (records ?? []).flatMap((r) =>
			r.audio_path ? [r.audio_path] : [],
		);
		if (paths.length > 0)
			await this.admin.storage.from("originals").remove(paths);
		await this.admin.from("records").delete().in("farm_id", this.farmIds);
		for (const table of [
			"events",
			"crops",
			"fields",
			"farm_members",
		] as const) {
			await this.admin.from(table).delete().in("farm_id", this.farmIds);
		}
		await this.admin.from("farms").delete().in("id", this.farmIds);
		for (const id of this.userIds) await this.admin.auth.admin.deleteUser(id);
	}
}
