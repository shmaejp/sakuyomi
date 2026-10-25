// 農場の日付。農場は日本にあるので、日付は日本時間で数える。

export const FARM_TIME_ZONE = "Asia/Tokyo";

/** 日時（ISO 8601）を、日本時間の曜日つきの日時（2026/10/24(土) 17:30）にする。 */
export function farmDateTimeOf(dateTime: string): string {
	return new Intl.DateTimeFormat("ja-JP", {
		timeZone: FARM_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(dateTime));
}

/** 日時（ISO 8601）の、日本時間での日付（YYYY-MM-DD）。 */
export function farmDateOf(dateTime: string): string {
	// en-CA は YYYY-MM-DD の形で日付を書く。
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: FARM_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(dateTime));
}
