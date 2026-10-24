import type { RecordSummary } from "../supabase/functions/_shared/record.ts";
import type { Client } from "./lib/supabase";

export type { RecordSummary };

/** 端末で作る 1 件の記録。記録 ID と記録日時は端末で決める。 */
export type NewRecord = {
	recordId: string;
	/** 端末で記録した日時（ISO 8601）。 */
	recordedAt: string;
	audio: Blob;
};

/** 記録を記録処理関数に送り、要約を受け取る。 */
export async function sendRecord(
	client: Client,
	record: NewRecord,
): Promise<RecordSummary> {
	const body = new FormData();
	body.set("recordId", record.recordId);
	body.set("recordedAt", record.recordedAt);
	body.set("audio", record.audio, "audio");
	const { data, error } = await client.functions.invoke<RecordSummary>(
		"record",
		{ body },
	);
	if (error) throw error;
	if (!data) throw new Error("要約が返りませんでした");
	return data;
}
