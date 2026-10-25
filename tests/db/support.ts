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

type Enums = Database["public"]["Enums"];

/** TestData.record で作る取り出し。結びつきは登録した圃場・作目・品種の id で渡す。 */
export type TestItem = {
	kind: Enums["extraction_kind"];
	body: string;
	/** 実施日（YYYY-MM-DD）。 */
	performedOn: string;
	fieldIds?: string[];
	/** 未確定の圃場の結びつき（話の中の言い方）。登録した圃場の後に並ぶ。 */
	unresolvedFields?: string[];
	cropIds?: string[];
	varietyIds?: string[];
	/** 判断のときだけ。 */
	judgeId?: string;
	/** 判断のときだけ。observation は同じ版の中の観察の位置。 */
	grounds?: ({ observation: number } | { text: string })[];
};

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
		values: {
			name: string;
			spokenNames?: string[];
			retiredAt?: string;
			latitude?: number;
			longitude?: number;
		},
	): Promise<string> {
		const { data, error } = await this.admin
			.from("fields")
			.insert({
				farm_id: farmId,
				name: values.name,
				spoken_names: values.spokenNames ?? [],
				retired_at: values.retiredAt ?? null,
				latitude: values.latitude ?? null,
				longitude: values.longitude ?? null,
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

	async variety(
		farmId: string,
		cropId: string,
		values: { name: string; spokenNames?: string[] },
	): Promise<string> {
		const { data, error } = await this.admin
			.from("varieties")
			.insert({
				farm_id: farmId,
				crop_id: cropId,
				name: values.name,
				spoken_names: values.spokenNames ?? [],
			})
			.select("id")
			.single();
		if (error) throw error;
		return data.id;
	}

	/**
	 * 記録と、その版を 1 つ作る（記録処理関数を通さずに）。正本は置かず、音声の場所だけを入れる。
	 * 取り出しは並べた順に入る。
	 */
	async record(
		farmId: string,
		values: {
			recorderId: string;
			recordedAt: string;
			items: TestItem[];
			transcript?: string;
		},
	): Promise<string> {
		const recordId = crypto.randomUUID();
		const { error } = await this.admin.from("records").insert({
			id: recordId,
			farm_id: farmId,
			recorder_member_id: values.recorderId,
			recorded_at: values.recordedAt,
			audio_path: `${farmId}/${recordId}/audio`,
		});
		if (error) throw error;
		await this.version(farmId, recordId, {
			items: values.items,
			transcript: values.transcript,
		});
		return recordId;
	}

	/** 記録に版を足す。後から足した版が最新の版になる。 */
	async version(
		farmId: string,
		recordId: string,
		values: {
			items: TestItem[];
			transcript?: string;
			/** 人の版（訂正）にするとき、訂正者と元にした版。なければ AI の版。 */
			correction?: { by: string; basedOn: string };
		},
	): Promise<string> {
		const { data: version, error } = await this.admin
			.from("versions")
			.insert({
				farm_id: farmId,
				record_id: recordId,
				author: values.correction ? "human" : "ai",
				transcript: values.transcript ?? null,
				corrected_by_member_id: values.correction?.by ?? null,
				based_on_version_id: values.correction?.basedOn ?? null,
			})
			.select("id")
			.single();
		if (error) throw error;
		const extractionIds: string[] = [];
		for (const [position, item] of values.items.entries()) {
			const { data: extraction, error: extractionError } = await this.admin
				.from("extractions")
				.insert({
					farm_id: farmId,
					version_id: version.id,
					position,
					kind: item.kind,
					body: item.body,
					performed_on: item.performedOn,
					judge_member_id: item.judgeId ?? null,
				})
				.select("id")
				.single();
			if (extractionError) throw extractionError;
			const base = (i: number) => ({
				farm_id: farmId,
				extraction_id: extraction.id,
				position: i,
			});
			const inserts = [
				this.admin.from("extraction_fields").insert(
					[
						...(item.fieldIds ?? []).map((id) => ({ field_id: id })),
						...(item.unresolvedFields ?? []).map((name) => ({
							spoken_as: name,
						})),
					].map((link, i) => ({ ...base(i), ...link })),
				),
				this.admin
					.from("extraction_crops")
					.insert(
						(item.cropIds ?? []).map((id, i) => ({ ...base(i), crop_id: id })),
					),
				this.admin.from("extraction_varieties").insert(
					(item.varietyIds ?? []).map((id, i) => ({
						...base(i),
						variety_id: id,
					})),
				),
			];
			for (const { error: linkError } of await Promise.all(inserts))
				if (linkError) throw linkError;
			extractionIds.push(extraction.id);
		}
		// 根拠は、指す観察の id がわかってから入れる。
		for (const [position, item] of values.items.entries()) {
			const grounds = (item.grounds ?? []).map((ground, i) => ({
				farm_id: farmId,
				judgment_id: extractionIds[position] as string,
				position: i,
				...("observation" in ground
					? { observation_id: extractionIds[ground.observation] }
					: { body: ground.text }),
			}));
			if (grounds.length === 0) continue;
			const { error: groundError } = await this.admin
				.from("grounds")
				.insert(grounds);
			if (groundError) throw groundError;
		}
		return version.id;
	}

	/** 記録の最新の版の id。 */
	async latestVersion(recordId: string): Promise<string> {
		const { data, error } = await this.admin
			.from("versions")
			.select("id")
			.eq("record_id", recordId)
			.order("created_at", { ascending: false })
			.order("id", { ascending: false })
			.limit(1)
			.single();
		if (error) throw error;
		return data.id;
	}

	async cleanUp() {
		// 記録を消すと、版・取り出し・結びつきも消える。正本はストレージから別に消す。
		const { data: records } = await this.admin
			.from("records")
			.select("audio_path, photo_paths")
			.in("farm_id", this.farmIds);
		const paths = (records ?? []).flatMap((r) => [
			...(r.audio_path ? [r.audio_path] : []),
			...r.photo_paths,
		]);
		if (paths.length > 0)
			await this.admin.storage.from("originals").remove(paths);
		await this.admin.from("records").delete().in("farm_id", this.farmIds);
		for (const table of [
			"events",
			"varieties",
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
