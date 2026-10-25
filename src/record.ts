import { FunctionsHttpError } from "@supabase/supabase-js";
import type {
	RecordResponse,
	RecordSummary,
} from "../supabase/functions/_shared/record.ts";
import type { Client } from "./lib/supabase";
import type { MeasuredLocation } from "./location";

export type { RecordResponse, RecordSummary };

/** 端末で作る 1 件の記録。記録 ID と記録日時は端末で決める。音声か写真の少なくとも一方がある。 */
export type NewRecord = {
	recordId: string;
	/** 端末で記録した日時（ISO 8601）。 */
	recordedAt: string;
	/** 写真だけの記録では null。 */
	audio: Blob | null;
	/** 撮った順の写真。 */
	photos: Blob[];
	/** 記録した場所。位置情報を許可していない・取れなかったときは null。 */
	location: MeasuredLocation | null;
};

/**
 * サーバーが記録を受け付けなかった（送り直しても通らない）。記録が壊れている・別の人の記録 ID と重なったなど。
 * 圏外・時間切れ・サーバーの一時的な失敗とは分ける。
 */
export class RecordRejected extends Error {
	constructor(readonly status: number) {
		super(`記録を受け付けませんでした（${status}）`);
	}
}

/** 送り直しても通らない応答。ログインの切れ（401）・時間切れ（408）・混雑（429）は送り直せば通りうる。 */
function isRejection(status: number) {
	return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

/**
 * 記録を記録処理関数に送り、応答を受け取る。応答が返れば、要約がなくても記録は保存されている。
 * 失敗したら同じ記録 ID で送り直してよい（二重にはならない）。受け付けられなかったときは RecordRejected を投げる。
 */
export async function sendRecord(
	client: Client,
	record: NewRecord,
): Promise<RecordResponse> {
	const body = new FormData();
	body.set("recordId", record.recordId);
	body.set("recordedAt", record.recordedAt);
	if (record.audio) body.set("audio", record.audio, "audio");
	if (record.location) {
		body.set("latitude", String(record.location.latitude));
		body.set("longitude", String(record.location.longitude));
		if (record.location.accuracyMeters !== null)
			body.set("accuracy", String(record.location.accuracyMeters));
	}
	for (const photo of record.photos) body.append("photos", photo, "photo");
	const { data, error } = await client.functions.invoke<RecordResponse>(
		"record",
		{ body },
	);
	if (error instanceof FunctionsHttpError) {
		const status = (error.context as Response).status;
		if (isRejection(status)) throw new RecordRejected(status);
	}
	if (error) throw error;
	if (!data) throw new Error("応答が返りませんでした");
	return data;
}
