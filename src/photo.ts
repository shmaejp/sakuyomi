// 撮った写真を、送る前に端末で縮める。縮めた写真がそのまま正本になる。
// スマホの写真は 1 枚 3〜5MB あり、そのまま送ると録音終了から要約までの 10 秒を圧迫するため。

/** 長い辺の画素数。Claude が写真を読むのに十分な大きさにとどめる。 */
const LONG_EDGE = 2000;
const JPEG_QUALITY = 0.85;

/** 写真を、長い辺が LONG_EDGE 以下の JPEG にする。向きは写真の記録（EXIF）に従う。 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
	const bitmap = await createImageBitmap(file, {
		imageOrientation: "from-image",
	});
	const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("写真を縮められませんでした");
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("写真を縮められませんでした")),
			"image/jpeg",
			JPEG_QUALITY,
		),
	);
}
