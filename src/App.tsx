import { useEffect, useState } from "react";
import { FarmScreen } from "./FarmScreen";
import { LoginScreen } from "./LoginScreen";
import { sessionStore, supabase } from "./lib/supabase";
import { watchSignedIn } from "./session";

export function App() {
	// undefined は「確かめる前」。端末に保存したセッションで決めるので、圏外でもすぐに決まる。
	const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);

	useEffect(() => watchSignedIn(supabase, sessionStore, setSignedIn), []);

	if (signedIn === undefined) return <main className="screen" />;
	if (!signedIn) return <LoginScreen />;
	return <FarmScreen />;
}
