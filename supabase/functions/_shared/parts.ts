// 記録処理関数に外から渡す、差し替えられる 2 つの部品。本番では本物を、テストでは偽物を渡す。

/** 農場に登録された圃場・作目・品種・農場メンバー。呼び名は話の中の言い方を結びつける手がかりになる。 */
export type Registered = { id: string; name: string; spokenNames: string[] };

/** 品種は作目の下にある。 */
export type RegisteredVariety = Registered & { cropId: string };

export type TranscriptionInput = {
	audio: Blob;
	/** 聞き取りの手がかりにする言葉（圃場・作目・品種の名前と呼び名、過去の作業に出た資材名）。 */
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
	/** 端末で記録した日時（ISO 8601）。実施日を読み取る基準になる。 */
	recordedAt: string;
	/** 記録者の農場メンバー。判断者の既定。 */
	recorderId: string;
	fields: Registered[];
	crops: Registered[];
	varieties: RegisteredVariety[];
	/** アプリを使わないメンバーも含む。判断者を見分ける手がかりになる。 */
	members: Registered[];
	/**
	 * 記録した場所の近くにある圃場（fields の中のもの）。近い順。位置がない記録や、近くに圃場がなければ空。
	 * あくまで候補で、どの圃場の話かは構造化が決める。
	 */
	nearbyFields: FieldCandidate[];
};

export type FieldCandidate = { id: string; distanceMeters: number };

/** 登録された圃場・作目なら id、登録にないものなら話の中の言い方（未確定）。 */
export type Link = { id: string } | { spokenAs: string };

export type ExtractionKind = "observation" | "judgment" | "work";

/** 判断の根拠。同じ記録の観察を指す（取り出しの一覧の中の位置）か、文章だけか。 */
export type Ground = { observation: number } | { text: string };

type ItemBase = {
	text: string;
	fields: Link[];
	crops: Link[];
	/** 品種への結びつき。省けばなし。 */
	varieties?: Link[];
	/** 話から読み取った実施日（YYYY-MM-DD、日本時間）。省けば記録日時の日付。 */
	performedOn?: string;
};

export type StructuredItem = ItemBase &
	(
		| { kind: "observation" }
		| {
				kind: "judgment";
				/** 判断者の農場メンバー。省けば記録者。 */
				judgeId?: string;
				grounds?: Ground[];
		  }
		| { kind: "work"; materials?: Material[] }
	);

/** 作業に使った資材。量・倍率は話されたままの言い方（「200リットル」「1000倍」）で、話されなければ null。 */
export type Material = {
	name: string;
	amount: string | null;
	dilution: string | null;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** 文字起こしから、観察・判断・作業と、その圃場・作目への結びつきを取り出す。 */
export type Structurer = (
	input: StructuringInput,
) => Promise<{ items: StructuredItem[]; usage: TokenUsage }>;
