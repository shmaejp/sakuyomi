// 記録処理関数の入口。本物の文字起こしと構造化を組み込み、処理は _shared/record.ts に任せる。
import { claudeStructurer } from "../_shared/claude-structurer.ts";
import { openAiTranscriber } from "../_shared/openai-transcriber.ts";
import { handleRecordRequest } from "../_shared/record.ts";

const env = (name: string) => {
	const value = Deno.env.get(name);
	if (!value) throw new Error(`${name} が設定されていません`);
	return value;
};

const deps = {
	supabaseUrl: env("SUPABASE_URL"),
	anonKey: env("SUPABASE_ANON_KEY"),
	transcribe: openAiTranscriber(env("OPENAI_API_KEY")),
	structure: claudeStructurer(env("ANTHROPIC_API_KEY")),
};

// PWA は別のオリジンから呼ぶので、CORS を許す。
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers":
		"authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
	if (request.method === "OPTIONS")
		return new Response("ok", { headers: cors });
	if (request.method !== "POST")
		return new Response(null, { status: 405, headers: cors });
	let response: Response;
	try {
		response = await handleRecordRequest(request, deps);
	} catch (error) {
		// 応答には中身を出さない。ログにも、リクエストの中身を含みうるエラーオブジェクトは出さず、種類と文だけを残す。
		console.error(
			"記録の処理に失敗しました",
			error instanceof Error ? `${error.name}: ${error.message}` : typeof error,
		);
		response = Response.json(
			{ error: "記録の処理に失敗しました" },
			{ status: 500 },
		);
	}
	for (const [name, value] of Object.entries(cors))
		response.headers.set(name, value);
	return response;
});
