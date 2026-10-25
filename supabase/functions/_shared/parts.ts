// 記録処理関数に外から渡す、差し替えられる 2 つの部品。本番では本物を、テストでは偽物を渡す。

/** 農場に登録された圃場・作目。呼び名は話の中の言い方を結びつける手がかりになる。 */
export type Registered = { id: string; name: string; spokenNames: string[] };

export type TranscriptionInput = {
	audio: Blob;
	/** 聞き取りの手がかりにする言葉（圃場・作目の名前と呼び名）。 */
	vocabulary: string[];
};

/** 音声を文字に起こす。仕組みはまだ選んでいないので、差し替えられるようにしておく。 */
export type Transcriber = (input: TranscriptionInput) => Promise<{
	text: string;
	/** この文字起こしにかかった料金（米ドル）。仕組みが料金を返さなければ null。 */
	costUsd: number | null;
}>;

/** 構造化（Claude）に渡せる写真の形式。記録処理関数は、これ以外の写真を受け付けない。 */
export const PHOTO_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export function isPhotoType(type: string): type is PhotoType {
	return (PHOTO_TYPES as readonly string[]).includes(type);
}

export type StructuringInput = {
	/** 写真だけの記録では null。そのときは観察だけを取り出す。 */
	transcript: string | null;
	/** 撮った順の写真。形式は PHOTO_TYPES のどれか。 */
	photos: Blob[];
	/** 端末で記録した日時（ISO 8601）。 */
	recordedAt: string;
	fields: Registered[];
	crops: Registered[];
};

/** 登録された圃場・作目なら id、登録にないものなら話の中の言い方（未確定）。 */
export type Link = { id: string } | { spokenAs: string };

export type ExtractionKind = "observation" | "judgment" | "work";

export type StructuredItem = {
	kind: ExtractionKind;
	text: string;
	fields: Link[];
	crops: Link[];
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** 文字起こしから、観察・判断・作業と、その圃場・作目への結びつきを取り出す。 */
export type Structurer = (
	input: StructuringInput,
) => Promise<{ items: StructuredItem[]; usage: TokenUsage }>;
