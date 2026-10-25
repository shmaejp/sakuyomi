// 位置（緯度・経度）の計算。

export type Location = { latitude: number; longitude: number };

const EARTH_RADIUS_METERS = 6_371_000;

/** 2 つの位置の間の、地表に沿った距離（メートル）。圃場の候補を出すくらいの近さなら、球として計算して十分。 */
export function distanceMeters(a: Location, b: Location): number {
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	const dLatitude = toRadians(b.latitude - a.latitude);
	const dLongitude = toRadians(b.longitude - a.longitude);
	const h =
		Math.sin(dLatitude / 2) ** 2 +
		Math.cos(toRadians(a.latitude)) *
			Math.cos(toRadians(b.latitude)) *
			Math.sin(dLongitude / 2) ** 2;
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** 端末で測った位置。accuracyMeters は端末が見積もった誤差の半径で、分からなければ null。 */
export type MeasuredLocation = Location & { accuracyMeters: number | null };
