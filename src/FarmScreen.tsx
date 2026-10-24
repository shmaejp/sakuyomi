import { useEffect, useState } from "react";
import { loadMyFarm, type MyFarm } from "./farm";
import { supabase } from "./lib/supabase";

type State =
	| { kind: "loading" }
	| { kind: "loaded"; farm: MyFarm | null }
	| { kind: "failed" };

export function FarmScreen() {
	const [state, setState] = useState<State>({ kind: "loading" });

	useEffect(() => {
		loadMyFarm(supabase).then(
			(farm) => setState({ kind: "loaded", farm }),
			() => setState({ kind: "failed" }),
		);
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

	if (state.kind === "loading") return <main className="screen" />;
	if (state.kind === "failed") {
		return (
			<main className="screen">
				<p role="alert">
					農場の情報を読み込めませんでした。電波のあるところで開き直してください。
				</p>
				{signOut}
			</main>
		);
	}
	if (state.farm === null) {
		return (
			<main className="screen">
				<p>このメールアドレスは、どの農場にも登録されていません。</p>
				{signOut}
			</main>
		);
	}

	const { farm } = state;
	return (
		<main className="screen">
			<h1>{farm.name}</h1>
			<section>
				<h2>圃場</h2>
				<NamedList items={farm.fields} />
			</section>
			<section>
				<h2>作目</h2>
				<NamedList items={farm.crops} />
			</section>
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
