import { useEffect, useState } from "react";
import { loadMyFarm, type MyFarm } from "./farm";
import { supabase } from "./lib/supabase";
import { RecordPanel } from "./RecordPanel";

type State =
	| { kind: "loading" }
	| { kind: "loaded"; farm: MyFarm | null }
	| { kind: "failed" };

// 記録の画面は、農場を読み込む前・読み込めなかったとき（圏外）も出す。開いたらすぐ録音でき、圏外でも記録できるようにするため。
// 出さないのは、農場メンバーでないとわかったときだけ。
export function FarmScreen() {
	const [state, setState] = useState<State>({ kind: "loading" });

	useEffect(() => {
		let active = true;
		const load = () =>
			loadMyFarm(supabase).then(
				(farm) => active && setState({ kind: "loaded", farm }),
				// 一度読み込めていれば、読み直しに失敗しても、読み込めた内容を出し続ける。
				() =>
					active &&
					setState((current) =>
						current.kind === "loaded" ? current : { kind: "failed" },
					),
			);
		load();
		// 圏外で読み込めなかったときのため、オンラインに戻ったら読み直す。
		window.addEventListener("online", load);
		return () => {
			active = false;
			window.removeEventListener("online", load);
		};
	}, []);

	const signOut = (
		<button
			type="button"
			className="secondary"
			onClick={() => supabase.auth.signOut()}
		>
			ログアウト
		</button>
	);

	if (state.kind === "loaded" && state.farm === null) {
		return (
			<main className="screen">
				<p>このメールアドレスは、どの農場にも登録されていません。</p>
				{signOut}
			</main>
		);
	}

	const farm = state.kind === "loaded" ? state.farm : null;
	// 読み込み直しても録音中の記録や送信待ちの表示が消えないよう、RecordPanel は常に同じ位置に置く。
	return (
		<main className="screen">
			{farm && <h1>{farm.name}</h1>}
			{state.kind === "failed" && (
				<p className="farm-status">
					農場の情報は、電波が戻ったら読み込みます。記録はこのまま残せます。
				</p>
			)}
			<RecordPanel />
			{farm && (
				<>
					<section>
						<h2>圃場</h2>
						<NamedList items={farm.fields} />
					</section>
					<section>
						<h2>作目</h2>
						<NamedList items={farm.crops} />
					</section>
				</>
			)}
			{signOut}
		</main>
	);
}

function NamedList({
	items,
}: {
	items: { id: string; name: string; spokenNames: string[] }[];
}) {
	if (items.length === 0) return <p>まだ登録されていません。</p>;
	return (
		<ul className="named-list">
			{items.map((item) => (
				<li key={item.id}>
					<span className="name">{item.name}</span>
					{item.spokenNames.length > 0 && (
						<span className="spoken-names">{item.spokenNames.join("・")}</span>
					)}
				</li>
			))}
		</ul>
	);
}
