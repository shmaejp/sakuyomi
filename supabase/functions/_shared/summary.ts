// 要約を DB から組み立てる。記録処理関数の応答と、即時応答の後半（直近の記録・去年の同じ時期の記録）で使う。
// 呼び出したメンバーのクライアントで読むので、RLS で見える記録の要約しか作れない。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/database.types.ts";
import type { Material } from "./parts.ts";

type Client = SupabaseClient<Database>;

/** 結びついた圃場・作目・品種。id が null なら未確定で、name は話の中の言い方。 */
type Named = { id: string | null; name: string };

/** 判断の根拠。observation は同じ要約の中の観察の位置で、文章だけの根拠なら null。text はどちらでも入る。 */
type SummaryGround = { observation: number | null; text: string };

export type SummaryItem = {
	text: string;
	/** 実施日（YYYY-MM-DD）。 */
	performedOn: string;
	fields: Named[];
	crops: Named[];
	varieties: Named[];
} & (
	| { kind: "observation" }
	| {
			kind: "judgment";
			judge: { id: string; name: string };
			grounds: SummaryGround[];
	  }
	| { kind: "work"; materials: Material[] }
);

export type RecordSummary = {
	recordId: string;
	versionId: string;
	/** 写真だけの記録では null。 */
	transcript: string | null;
	items: SummaryItem[];
	/** 最新の版が人の版（訂正済みの記録）なら、最後の訂正者・訂正日時・元にした版。AI の版なら null。 */
	correction: Correction | null;
};

export type Correction = {
	by: { id: string; name: string };
	/** 訂正日時（ISO 8601）。 */
	at: string;
	basedOnVersionId: string;
};

/** 記録の最新の版の要約。版がなければ null。 */
export async function loadSummary(
	client: Client,
	recordId: string,
): Promise<RecordSummary | null> {
	return (await loadSummaries(client, [recordId])).get(recordId) ?? null;
}

/**
 * 記録ごとの最新の版の要約を 1 度に読む。版のない記録は入らない。
 * 最新の版の決め方（作った日時、同じなら id の大きいほう）は、ビュー latest_versions と同じにする。
 */
export async function loadSummaries(
	client: Client,
	recordIds: string[],
): Promise<Map<string, RecordSummary>> {
	if (recordIds.length === 0) return new Map();
	const { data: versions, error } = await selectVersions(client, recordIds);
	if (error) throw error;

	const summaries = new Map<string, RecordSummary>();
	for (const version of versions) {
		if (!summaries.has(version.record_id))
			summaries.set(version.record_id, toSummary(version));
	}
	return summaries;
}

/** 記録の版を、新しい順に、要約に要るものと一緒に読む。 */
function selectVersions(client: Client, recordIds: string[]) {
	return client
		.from("versions")
		.select(
			`id, record_id, transcript, author, created_at, based_on_version_id,
			corrector:farm_members!versions_corrected_by_member_id_fkey (id, display_name),
			extractions (
				id, position, kind, body, performed_on, judge_member_id,
				judge:farm_members!extractions_judge_member_id_fkey (display_name),
				extraction_fields (position, field_id, spoken_as, fields (name)),
				extraction_crops (position, crop_id, spoken_as, crops (name)),
				extraction_varieties (position, variety_id, spoken_as, varieties (name)),
				grounds!grounds_judgment_id_fkey (position, observation_id, body),
				work_materials (position, name, amount, dilution)
			)`,
		)
		.in("record_id", recordIds)
		.order("created_at", { ascending: false })
		.order("id", { ascending: false });
}

type LoadedVersion = NonNullable<
	Awaited<ReturnType<typeof selectVersions>>["data"]
>[number];

function toSummary(version: LoadedVersion): RecordSummary {
	const extractions = version.extractions.sort(byPosition);
	const positionOf = new Map(extractions.map((e, i) => [e.id, i]));
	const bodyOf = new Map(extractions.map((e) => [e.id, e.body]));
	return {
		recordId: version.record_id,
		versionId: version.id,
		transcript: version.transcript,
		correction:
			version.author === "human" &&
			version.corrector &&
			version.based_on_version_id
				? {
						by: {
							id: version.corrector.id,
							name: version.corrector.display_name,
						},
						at: version.created_at,
						basedOnVersionId: version.based_on_version_id,
					}
				: null,
		items: extractions.map((e): SummaryItem => {
			const base = {
				text: e.body,
				performedOn: e.performed_on,
				fields: named(
					e.extraction_fields.map((l) => ({
						...l,
						id: l.field_id,
						name: l.fields?.name,
					})),
				),
				crops: named(
					e.extraction_crops.map((l) => ({
						...l,
						id: l.crop_id,
						name: l.crops?.name,
					})),
				),
				varieties: named(
					e.extraction_varieties.map((l) => ({
						...l,
						id: l.variety_id,
						name: l.varieties?.name,
					})),
				),
			};
			if (e.kind === "observation") return { ...base, kind: "observation" };
			if (e.kind === "work")
				return {
					...base,
					kind: "work",
					materials: e.work_materials
						.sort(byPosition)
						.map(({ name, amount, dilution }) => ({ name, amount, dilution })),
				};
			return {
				...base,
				kind: "judgment",
				judge: {
					id: e.judge_member_id ?? "",
					name: e.judge?.display_name ?? "",
				},
				grounds: e.grounds.sort(byPosition).map((ground) =>
					ground.observation_id
						? {
								observation: positionOf.get(ground.observation_id) ?? null,
								text: bodyOf.get(ground.observation_id) ?? "",
							}
						: { observation: null, text: ground.body ?? "" },
				),
			};
		}),
	};
}

/** 結びつきを並び順に並べる。登録された圃場・作目・品種なら登録の名前、未確定なら話の中の言い方。 */
function named(
	links: {
		position: number;
		id: string | null;
		name: string | undefined;
		spoken_as: string | null;
	}[],
): Named[] {
	return links
		.sort(byPosition)
		.map((link) =>
			link.id
				? { id: link.id, name: link.name ?? "" }
				: { id: null, name: link.spoken_as ?? "" },
		);
}

function byPosition(a: { position: number }, b: { position: number }) {
	return a.position - b.position;
}
