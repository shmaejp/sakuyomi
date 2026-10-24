// PreToolUse hook: 秘密情報を含む .env 系ファイルと、鍵を表示するコマンドを Claude Code に使わせない。
// 変数名だけを書いた .env.example は読める。settings.json の permissions.deny と二重に守る。
import { readFileSync } from "node:fs";

// `.env`・`.env.local`・`supabase/.env` などに当たり、`.env.example` には当たらない。
const ENV_FILE =
	/(?<![\w-])\.env(?!\.example(?![\w.-]))(?:\.[\w.-]*)?(?![\w-])/;
// `supabase status` は鍵を表示する。出力を捨てて起動を確かめるだけなら許す。
const KEY_DUMP = /supabase(?:\.js)?\s+status\b(?![^|;&]*>\s*\/dev\/null)/;

const input = JSON.parse(readFileSync(0, "utf8"));
const toolInput = input.tool_input ?? {};

const block = (reason) => {
	process.stderr.write(
		`${reason}必要なら、ユーザーが自分で \`!\` を付けて実行してください。`,
	);
	process.exit(2);
};

if (input.tool_name === "Bash" || input.tool_name === "PowerShell") {
	const command = String(toolInput.command ?? "");
	if (ENV_FILE.test(command))
		block(
			"秘密情報を含む .env 系ファイルに触れるコマンドは止めています（.env.example は使えます）。",
		);
	if (KEY_DUMP.test(command))
		block("`supabase status` は鍵を表示するため止めています。");
} else {
	const paths = [toolInput.file_path, toolInput.path, toolInput.glob]
		.filter((p) => typeof p === "string")
		.map((p) => p.replaceAll("\\", "/"));
	if (paths.some((p) => ENV_FILE.test(p)))
		block(
			"秘密情報を含む .env 系ファイルは読めないようにしています（.env.example は読めます）。",
		);
}
process.exit(0);
