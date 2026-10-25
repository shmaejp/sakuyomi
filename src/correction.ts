import type { Material } from "../supabase/functions/_shared/parts.ts";
import {
	loadSummary,
	type RecordSummary,
	type SummaryItem,
} from "../supabase/functions/_shared/summary.ts";
import type { Client } from "./lib/supabase";

/** 直した後の結びつき。登録された圃場・作目・品種なら id、未確定なら話の中の言い方。 */
export type CorrectedLink = { id: string } | { spokenAs: string };

/** 直した後の根拠。同じ版の中の観察の位置か、文章だけ。 */
export type CorrectedGround = { observation: number } | { text: string };

/** 直した後の取り出し 1 つ。訂正では、新しい版の取り出しをすべて渡す。 */
export type CorrectedItem = {
	text: string;
	/** 実施日（YYYY-MM-DD）。 */
	performedOn: string;
	fields: CorrectedLink[];
	crops: CorrectedLink[];
	varieties: CorrectedLink[];
} & (
	| { kind: "observation" }
	/** judgeId が null なら、記録者が判断者になる。 */
	| { kind: "judgment"; judgeId: string | null; grounds: CorrectedGround[] }
	| { kind: "work"; materials: Material[] }
);

/**
 * 訂正の結果。どれも summary はその記録の最新の版の要約。
 * - corrected：人の版を新しく作った
 * - unchanged：何も変わっていないので、版を作らなかった（summary は元にした版）
 * - stale：元にした版が最新ではない（他の人が先に訂正した）ので、保存しなかった。summary をもとに直し直す
 */
export type CorrectionResult = {
	status: "corrected" | "unchanged" | "stale";
	summary: RecordSummary;
};

/** 要約の取り出しを、訂正で直す前の形にする。何も直さずに渡せば unchanged になる。 */
export function toCorrectedItems(summary: RecordSummary): CorrectedItem[] {
	return summary.items.map((item): CorrectedItem => {
		const base = {
			text: item.text,
			performedOn: item.performedOn,
			fields: item.fields.map(toLink),
			crops: item.crops.map(toLink),
			varieties: item.varieties.map(toLink),
		};
		if (item.kind === "judgment")
			return {
				...base,
				kind: "judgment",
				judgeId: item.judge.id,
				grounds: item.grounds.map((ground) =>
					ground.observation === null
						? { text: ground.text }
						: { observation: ground.observation },
				),
			};
		if (item.kind === "work")
			return { ...base, kind: "work", materials: item.materials };
		return { ...base, kind: "observation" };
	});
}

/** 登録された圃場・作目・品種への結びつきの id（未確定のものは除く）。 */
export function linkedIds(links: CorrectedLink[]): string[] {
	return links.flatMap((link) => ("id" in link ? [link.id] : []));
}

/** サーバーが訂正を受け付けなかった（直した内容が検査を通らなかった）。圏外などの失敗とは分ける。 */
export class CorrectionRejected extends Error {
	constructor(readonly code: string) {
		super(`訂正を受け付けませんでした（${code}）`);
	}
}

function toLink(named: SummaryItem["fields"][number]): CorrectedLink {
	return named.id ? { id: named.id } : { spokenAs: named.name };
}

/**
 * 記録を訂正する。元にした版（baseVersionId）と、直した後の取り出しの全件を渡す。
 * 訂正者はログイン中の農場メンバー、訂正日時はサーバーの日時になる。
 * 他の農場の圃場・作目・品種、作目に合わない品種、版のない記録などは拒否され、例外を投げる。
 * 訂正の保存には電波が要る（送信待ちの列には入れない）。
 */
export async function correctRecord(
	client: Client,
	request: {
		recordId: string;
		baseVersionId: string;
		items: CorrectedItem[];
	},
): Promise<CorrectionResult> {
	const { data, error } = await client.rpc("correct_record", {
		target_record_id: request.recordId,
		base_version_id: request.baseVersionId,
		items: request.items.map(toRpcItem),
	});
	// DB が拒否したときは SQLSTATE が入る。届かなかったとき（圏外など）は入らない。
	if (error?.code) throw new CorrectionRejected(error.code);
	if (error) throw error;
	const { status } = data as { status: CorrectionResult["status"] };
	const summary = await loadSummary(client, request.recordId);
	if (!summary) throw new Error("訂正した記録の要約を読めませんでした");
	return { status, summary };
}

/** RPC の items の形（save_ai_version と同じ）にする。 */
function toRpcItem(item: CorrectedItem) {
	const toRpcLinks = (links: CorrectedLink[]) =>
		links.map((link) =>
			"id" in link ? { id: link.id } : { spoken_as: link.spokenAs },
		);
	return {
		kind: item.kind,
		body: item.text,
		performed_on: item.performedOn,
		fields: toRpcLinks(item.fields),
		crops: toRpcLinks(item.crops),
		varieties: toRpcLinks(item.varieties),
		...(item.kind === "judgment" && {
			judge_member_id: item.judgeId,
			grounds: item.grounds.map((ground) =>
				"observation" in ground
					? { observation: ground.observation }
					: { body: ground.text },
			),
		}),
		...(item.kind === "work" && { materials: item.materials }),
	};
}

/** 訂正で選べる圃場・作目・品種。呼び名つき。 */
export type CorrectionChoices = {
	/** 廃止された圃場も含む（区画が変わる前の話に結びつけるため）。 */
	fields: {
		id: string;
		name: string;
		spokenNames: string[];
		retired: boolean;
	}[];
	crops: { id: string; name: string; spokenNames: string[] }[];
	varieties: {
		id: string;
		cropId: string;
		name: string;
		spokenNames: string[];
	}[];
};

/** 訂正で選べる圃場・作目・品種を、登録した順に読む。見えるのは RLS で自分の農場のものだけ。 */
export async function loadCorrectionChoices(
	client: Client,
): Promise<CorrectionChoices> {
	const [fields, crops, varieties] = await Promise.all([
		client
			.from("fields")
			.select("id, name, spoken_names, retired_at")
			.order("created_at"),
		client.from("crops").select("id, name, spoken_names").order("created_at"),
		client
			.from("varieties")
			.select("id, crop_id, name, spoken_names")
			.order("created_at"),
	]);
	if (fields.error) throw fields.error;
	if (crops.error) throw crops.error;
	if (varieties.error) throw varieties.error;
	return {
		fields: fields.data.map((f) => ({
			id: f.id,
			name: f.name,
			spokenNames: f.spoken_names,
			retired: f.retired_at !== null,
		})),
		crops: crops.data.map((c) => ({
			id: c.id,
			name: c.name,
			spokenNames: c.spoken_names,
		})),
		varieties: varieties.data.map((v) => ({
			id: v.id,
			cropId: v.crop_id,
			name: v.name,
			spokenNames: v.spoken_names,
		})),
	};
}

/**
 * 取り出しの種別を変える。判断にすると判断者は記録者（judgeId: null）・根拠なし、作業にすると資材なしで始まる。
 * 元の種別にしかない判断者・根拠・資材は外す。
 */
export function withKind(
	item: CorrectedItem,
	kind: CorrectedItem["kind"],
): CorrectedItem {
	if (item.kind === kind) return item;
	const { text, performedOn, fields, crops, varieties } = item;
	const base = { text, performedOn, fields, crops, varieties };
	if (kind === "judgment") return { ...base, kind, judgeId: null, grounds: [] };
	if (kind === "work") return { ...base, kind, materials: [] };
	return { ...base, kind };
}

/**
 * 取り出しを消す。消した観察を指していた根拠は、その観察の文章を写した文章だけの根拠にする（根拠を宙に浮かせない）。
 * 後ろの観察を指す根拠は、同じ観察を指したまま位置を付け直す。detached は文章だけにした根拠の数（画面で知らせる）。
 */
export function removeItem(
	items: CorrectedItem[],
	index: number,
): { items: CorrectedItem[]; detached: number } {
	const removed = items[index];
	let detached = 0;
	const kept = items
		.filter((_, i) => i !== index)
		.map((item): CorrectedItem => {
			if (item.kind !== "judgment") return item;
			return {
				...item,
				grounds: item.grounds.map((ground) => {
					if (!("observation" in ground)) return ground;
					if (ground.observation === index) {
						detached++;
						return { text: removed?.text ?? "" };
					}
					return ground.observation > index
						? { observation: ground.observation - 1 }
						: ground;
				}),
			};
		});
	return { items: kept, detached };
}

/**
 * 取り出しの種別を変える（withKind）。観察でなくなるなら、その観察を指していた根拠は文章だけの根拠にする。
 * detached は文章だけにした根拠の数。
 */
export function changeKind(
	items: CorrectedItem[],
	index: number,
	kind: CorrectedItem["kind"],
): { items: CorrectedItem[]; detached: number } {
	const target = items[index];
	if (!target || target.kind === kind) return { items, detached: 0 };
	let detached = 0;
	const changed = items.map((item, i): CorrectedItem => {
		if (i === index) return withKind(item, kind);
		if (item.kind !== "judgment" || target.kind !== "observation") return item;
		return {
			...item,
			grounds: item.grounds.map((ground) => {
				if (!("observation" in ground) || ground.observation !== index)
					return ground;
				detached++;
				return { text: target.text };
			}),
		};
	});
	return { items: changed, detached };
}
