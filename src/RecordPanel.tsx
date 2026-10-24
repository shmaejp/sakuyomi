import { useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { type RecordSummary, sendRecord } from "./record";

type State =
	| { kind: "idle" }
	| { kind: "recording" }
	| { kind: "sending" }
	| { kind: "done"; summary: RecordSummary }
	| { kind: "failed"; message: string };

const KIND_LABELS = { observation: "観察", judgment: "判断", work: "作業" };

// ボタン 1 つで録音を始め、もう 1 度押すと終えて送り、要約を表示する。
export function RecordPanel() {
	const [state, setState] = useState<State>({ kind: "idle" });
	const recorder = useRef<MediaRecorder | null>(null);

	async function start() {
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			setState({
				kind: "failed",
				message: "マイクを使えません。マイクの使用を許可してください。",
			});
			return;
		}
		const recordId = crypto.randomUUID();
		const recordedAt = new Date().toISOString();
		const chunks: Blob[] = [];
		const mediaRecorder = new MediaRecorder(stream);
		mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
		mediaRecorder.onstop = async () => {
			for (const track of stream.getTracks()) track.stop();
			setState({ kind: "sending" });
			const audio = new Blob(chunks, { type: mediaRecorder.mimeType });
			try {
				const summary = await sendRecord(supabase, {
					recordId,
					recordedAt,
					audio,
				});
				setState({ kind: "done", summary });
			} catch {
				setState({
					kind: "failed",
					message: "記録を送れませんでした。電波のあるところで試してください。",
				});
			}
		};
		recorder.current = mediaRecorder;
		mediaRecorder.start();
		setState({ kind: "recording" });
	}

	function stop() {
		recorder.current?.stop();
		recorder.current = null;
	}

	return (
		<section className="record-panel">
			{state.kind === "recording" ? (
				<button
					type="button"
					className="record-button recording"
					onClick={stop}
				>
					終えて送る
				</button>
			) : (
				<button
					type="button"
					className="record-button"
					onClick={start}
					disabled={state.kind === "sending"}
				>
					{state.kind === "sending" ? "送っています…" : "録音する"}
				</button>
			)}
			{state.kind === "failed" && <p role="alert">{state.message}</p>}
			{state.kind === "done" && <Summary summary={state.summary} />}
		</section>
	);
}

function Summary({ summary }: { summary: RecordSummary }) {
	if (summary.items.length === 0)
		return <p>記録しました。取り出せる内容はありませんでした。</p>;
	return (
		<ul className="summary">
			{summary.items.map((item, i) => (
				// 取り出しは並び順そのものが識別になる。
				// biome-ignore lint/suspicious/noArrayIndexKey: 要約の中で順序は変わらない
				<li key={i}>
					<span className="kind">{KIND_LABELS[item.kind]}</span>
					<span>{item.text}</span>
					<span className="links">
						{[...item.fields, ...item.crops]
							.map((link) => (link.id ? link.name : `${link.name}（未確定）`))
							.join("・")}
					</span>
				</li>
			))}
		</ul>
	);
}
