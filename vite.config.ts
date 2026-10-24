import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "サクヨミ",
				short_name: "サクヨミ",
				lang: "ja",
				start_url: "/",
				display: "standalone",
				background_color: "#f7f5ef",
				theme_color: "#3f6b3a",
				icons: [
					{
						src: "/icon.svg",
						sizes: "any",
						type: "image/svg+xml",
						purpose: "any",
					},
				],
			},
		}),
	],
});
