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
		if (!response.ok) {
			// 429 は残高切れ（insufficient_quota）と送りすぎ（rate_limit_exceeded）の両方があるので、code で見分ける。
			const failure: { error?: { code?: string } } = await response
				.json()
				.catch(() => ({}));
			const code = failure.error?.code ?? "不明";
			throw new Error(
				`文字起こしに失敗しました（HTTP ${response.status}、${code}）`,
			);
		}
		const body: { text: string; usage?: Usage } = await response.json();
		return { text: body.text, costUsd: costOf(body.usage) };
	};
}

/** gpt-4o-transcribe はトークン数で課金される。 */
type Usage = {
	type: string;
	input_tokens?: number;
	output_tokens?: number;
	input_token_details?: { text_tokens?: number; audio_tokens?: number };
};

// 100 万トークンあたりの米ドル（gpt-4o-transcribe の料金表による）。
const USD_PER_MILLION = { audioInput: 6, textInput: 2.5, output: 10 };

function costOf(usage: Usage | undefined): number | null {
	if (usage?.type !== "tokens") return null;
	const audio = usage.input_token_details?.audio_tokens ?? 0;
	const text = usage.input_token_details?.text_tokens ?? 0;
	const output = usage.output_tokens ?? 0;
	return (
		(audio * USD_PER_MILLION.audioInput +
			text * USD_PER_MILLION.textInput +
			output * USD_PER_MILLION.output) /
		1_000_000
	);
}

/** 拡張子で音声の形式を見分けるので、MIME タイプに合う名前を付ける。 */
function fileNameFor(mimeType: string) {
	if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "audio.m4a";
	if (mimeType.includes("ogg")) return "audio.ogg";
	if (mimeType.includes("wav")) return "audio.wav";
	if (mimeType.includes("mpeg")) return "audio.mp3";
	return "audio.webm";
}
