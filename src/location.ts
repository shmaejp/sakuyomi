import type { MeasuredLocation } from "../supabase/functions/_shared/geo.ts";

export type { MeasuredLocation };

/**
 * 今の位置を取りにいく。位置情報を許可されていない・取れない・使えない端末では null になる（記録は位置なしで送る）。
 * 初めて呼ぶと、端末が位置情報の許可を求める。
 */
export function requestLocation(): Promise<MeasuredLocation | null> {
	return new Promise((resolve) => {
		if (!("geolocation" in navigator)) return resolve(null);
		navigator.geolocation.getCurrentPosition(
			({ coords }) =>
				resolve({
					latitude: coords.latitude,
					longitude: coords.longitude,
					accuracyMeters: coords.accuracy,
				}),
			() => resolve(null),
			// 圃場の候補を出すには数十 m の精度が要る。少し前に取った位置でもよい。
			{ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
		);
	});
}

/** 位置を待つのは ms までにする。要約が出るのを遅らせないため。間に合わなければ null。 */
export function locationWithin(
	location: Promise<MeasuredLocation | null>,
	ms: number,
): Promise<MeasuredLocation | null> {
	return Promise.race([
		location,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
	]);
}
