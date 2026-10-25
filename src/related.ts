import {
	loadSummaries,
	type RecordSummary,
} from "../supabase/functions/_shared/summary.ts";
import type { Client } from "./lib/supabase";

/** 即時応答の後半に出す 1 件の記録。中身はその記録の最新の版から出す。 */
export type RelatedRecord = {
	recordId: string;
	/** 記録日時（ISO 8601）。 */
	recordedAt: string;
	recorder: { id: string; name: string };
	summary: RecordSummary;
};

export type RelatedRecords = {
	/** 同じ圃場または同じ作目の直近の記録。新しい順。 */
	recent: RelatedRecord[];
	/** 同じ作目の去年の同じ時期の記録。品種が一致するものが先、次に日付が近いものが先。 */
	lastYear: RelatedRecord[];
};

/** 直近の記録・去年の同じ時期の記録の探し方。どれも n1 で決め直す設定値。 */
export type RelatedSettings = {
	/** 直近の記録の件数。 */
	recentCount: number;
	/** 去年の同じ時期として、1 年前の同じ日付の前後何日までを入れるか。 */
	seasonDays: number;
};

const DEFAULT_RELATED_SETTINGS: RelatedSettings = {
	recentCount: 5,
	seasonDays: 14,
};

/**
 * 記録の取り出しに結びついた圃場・作目をもとに、直近の記録と去年の同じ時期の記録を読む。
 * 要約を返した後に、別の呼び出しとして使う（要約を遅らせないため）。見えるのは RLS で自分の農場の記録だけ。
 */
export async function loadRelatedRecords(
	client: Client,
	recordId: string,
	settings: Partial<RelatedSettings> = {},
): Promise<RelatedRecords> {
	const { recentCount, seasonDays } = {
		...DEFAULT_RELATED_SETTINGS,
		...settings,
	};
	const [recent, lastYear] = await Promise.all([
		client.rpc("recent_records", {
			target_record_id: recordId,
			max_count: recentCount,
		}),
		client.rpc("last_year_records", {
			target_record_id: recordId,
			season_days: seasonDays,
		}),
	]);
	if (recent.error) throw recent.error;
	if (lastYear.error) throw lastYear.error;
	const recentIds = recent.data.map((r) => r.record_id);
	const lastYearIds = lastYear.data.map((r) => r.record_id);
	const loaded = await loadRecords(client, [
		...new Set([...recentIds, ...lastYearIds]),
	]);
	const inOrder = (ids: string[]) => ids.flatMap((id) => loaded.get(id) ?? []);
	return { recent: inOrder(recentIds), lastYear: inOrder(lastYearIds) };
}

/** 記録と、その最新の版の要約を、まとめて読む。版のない記録は入らない。 */
async function loadRecords(
	client: Client,
	recordIds: string[],
): Promise<Map<string, RelatedRecord>> {
	if (recordIds.length === 0) return new Map();
	const [records, summaries] = await Promise.all([
		client
			.from("records")
			.select("id, recorded_at, recorder:farm_members (id, display_name)")
			.in("id", recordIds),
		loadSummaries(client, recordIds),
	]);
	if (records.error) throw records.error;
	const loaded = new Map<string, RelatedRecord>();
	for (const record of records.data) {
		const summary = summaries.get(record.id);
		if (!summary) continue;
		loaded.set(record.id, {
			recordId: record.id,
			recordedAt: record.recorded_at,
			recorder: {
				id: record.recorder.id,
				name: record.recorder.display_name,
			},
			summary,
		});
	}
	return loaded;
}
