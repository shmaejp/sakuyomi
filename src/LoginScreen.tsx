import { type FormEvent, useState } from "react";
import { supabase } from "./lib/supabase";

// メールのマジックリンクでログインする。iPhone のホーム画面に置いた PWA は Safari と保存場所が別で、
// メールのリンクを開くと Safari 側でログインしてしまうため、同じメールに載る 6 桁のコードでも入れるようにする。
export function LoginScreen() {
	const [email, setEmail] = useState("");
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function sendLink(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		setMessage(null);
		const { error } = await supabase.auth.signInWithOtp({
			email,
			// アプリからの新規登録は受け付けない。農場メンバーとして招待された人だけがログインできる。
			options: {
				shouldCreateUser: false,
				emailRedirectTo: window.location.origin,
			},
		});
		setBusy(false);
		if (error) {
			setMessage(
				"メールを送れませんでした。招待されたメールアドレスか確かめてください。",
			);
			return;
		}
		setSentTo(email);
	}

	async function verifyCode(event: FormEvent) {
		event.preventDefault();
		if (!sentTo) return;
		setBusy(true);
		setMessage(null);
		const { error } = await supabase.auth.verifyOtp({
			email: sentTo,
			token: code.trim(),
			type: "email",
		});
		setBusy(false);
		if (error) setMessage("コードが違うか、期限が切れています。");
	}

	if (sentTo) {
		return (
			<main className="screen">
				<h1>サクヨミ</h1>
				<p>
					{sentTo}{" "}
					にメールを送りました。メールのリンクを開くか、メールに書かれたコードを入れてください。
				</p>
				<form onSubmit={verifyCode}>
					<label>
						コード
						<input
							inputMode="numeric"
							autoComplete="one-time-code"
							value={code}
							onChange={(e) => setCode(e.target.value)}
							required
						/>
					</label>
					<button type="submit" disabled={busy}>
						ログイン
					</button>
				</form>
				{message && <p role="alert">{message}</p>}
				<button
					type="button"
					className="secondary"
					onClick={() => setSentTo(null)}
				>
					メールアドレスを入れ直す
				</button>
			</main>
		);
	}

	return (
		<main className="screen">
			<h1>サクヨミ</h1>
			<form onSubmit={sendLink}>
				<label>
					メールアドレス
					<input
						type="email"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
					/>
				</label>
				<button type="submit" disabled={busy}>
					ログイン用のメールを送る
				</button>
			</form>
			{message && <p role="alert">{message}</p>}
		</main>
	);
}
