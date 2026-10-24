import type { Client } from "./lib/supabase";

export type MyFarm = {
	id: string;
	name: string;
	/** 廃止されていない圃場だけ。 */
	fields: { id: string; name: string; spokenNames: string[] }[];
	crops: { id: string; name: string; spokenNames: string[] }[];
};

/**
 * ログイン中の農場メンバーの農場と、その圃場・作目を読む。
 * 見えるのは RLS で自分の農場だけなので、農場メンバーでなければ（離れた場合も）null を返す。
 */
export async function loadMyFarm(client: Client): Promise<MyFarm | null> {
	const { data, error } = await client
		.from("farms")
		.select(
			"id, name, fields (id, name, spoken_names, retired_at, created_at), crops (id, name, spoken_names, created_at)",
		)
		.order("created_at")
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	const byCreatedAt = (a: { created_at: string }, b: { created_at: string }) =>
		a.created_at.localeCompare(b.created_at);
	return {
		id: data.id,
		name: data.name,
		fields: data.fields
			.filter((f) => f.retired_at === null)
			.sort(byCreatedAt)
			.map((f) => ({ id: f.id, name: f.name, spokenNames: f.spoken_names })),
		crops: data.crops
			.sort(byCreatedAt)
			.map((c) => ({ id: c.id, name: c.name, spokenNames: c.spoken_names })),
	};
}
