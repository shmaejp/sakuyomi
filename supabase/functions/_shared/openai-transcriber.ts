// 文字起こしの仮の部品。仕組みは n1 の録音で候補を比べて選ぶので、それまでの仮置き。
// OpenAI の gpt-4o-transcribe を使う。語彙は prompt で渡せ、API に送ったデータは既定で学習に使われない。
import type { Transcriber } from "./parts.ts";

const MODEL = "gpt-4o-transcribe";

export function openAiTranscriber(apiKey: string): Transcriber {
	return async ({ audio, vocabulary }) => {
		const form = new FormData();
		form.set("file", audio, fileNameFor(audio.type));
		form.set("model", MODEL);
		form.set("language", "ja");
		form.set("response_format", "json");
		if (vocabulary.length > 0)
			form.set("prompt", `農場の圃場・作目の名前：${vocabulary.join("、")}`);

		const response = await fetch(
			"https://api.openai.com/v1/audio/transcriptions",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
			},
		);
		if (!response.ok)
			throw new Error(`文字起こしに失敗しました（HTTP ${response.status}）`);
		const body: { text: string } = await response.json();
		return { text: body.text };
	};
}

/** 拡張子で音声の形式を見分けるので、MIME タイプに合う名前を付ける。 */
function fileNameFor(mimeType: string) {
	if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "audio.m4a";
	if (mimeType.includes("ogg")) return "audio.ogg";
	if (mimeType.includes("wav")) return "audio.wav";
	if (mimeType.includes("mpeg")) return "audio.mp3";
	return "audio.webm";
}
