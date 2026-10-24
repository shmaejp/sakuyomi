import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { FarmScreen } from "./FarmScreen";
import { LoginScreen } from "./LoginScreen";
import { supabase } from "./lib/supabase";

export function App() {
	// undefined は「セッションを確かめている途中」。
	const [session, setSession] = useState<Session | null | undefined>(undefined);

	useEffect(() => {
		supabase.auth.getSession().then(({ data }) => setSession(data.session));
		const { data } = supabase.auth.onAuthStateChange((_event, next) =>
			setSession(next),
		);
		return () => data.subscription.unsubscribe();
	}, []);

	if (session === undefined) return <main className="screen" />;
	if (session === null) return <LoginScreen />;
	return <FarmScreen />;
}
