import { useCallback, useEffect, useRef, useState } from "react";
import { openRecordQueue, type RecordQueue, type Sender } from "./queue";
import type { NewRecord, RecordResponse } from "./record";

/** 送れた記録と、その応答（即時応答に出す）。 */
export type SentRecord = { record: NewRecord; response: RecordResponse };

/**
 * 画面から送信待ちの列を使う。列は画面を開いたときに開いて送り始め、
 * オンラインに戻ったとき・アプリが前に出たとき（ホーム画面の PWA は開き直さず前に戻ることが多い）にも送る。
 */
export function useRecordQueue(send: Sender) {
	const [pending, setPending] = useState(0);
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState<SentRecord[]>([]);
	const queue = useRef<Promise<RecordQueue> | null>(null);

	useEffect(() => {
		const opening = openRecordQueue({
			send,
			onPendingChange: setPending,
			onSending: setSending,
			onSent: (record, response) =>
				setSent((current) => [{ record, response }, ...current]),
		});
		queue.current = opening;
		// 送れなかった記録は列に残るので、ここで失敗しても次の機会に送り直される。
		const flush = () => opening.then((q) => q.flush()).catch(() => undefined);
		const flushWhenVisible = () => {
			if (document.visibilityState === "visible") flush();
		};
		flush();
		window.addEventListener("online", flush);
		document.addEventListener("visibilitychange", flushWhenVisible);
		return () => {
			window.removeEventListener("online", flush);
			document.removeEventListener("visibilitychange", flushWhenVisible);
			opening.then((q) => q.close());
			queue.current = null;
		};
	}, [send]);

	/** 記録を列に入れる。列に入れば、送れていなくても記録は端末に残っている。 */
	const add = useCallback(async (record: NewRecord) => {
		if (!queue.current) throw new Error("送信待ちの列が開いていません");
		await (await queue.current).add(record);
	}, []);

	return { pending, sending, sent, add };
}
