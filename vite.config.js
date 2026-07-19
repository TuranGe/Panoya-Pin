import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { attachGameServer } from './src/lib/server/wsServer.js';

/** `npm run dev` sırasında oyun WebSocket sunucusunu Vite'ın http sunucusuna bağlar. */
function gameServerDevPlugin() {
	return {
		name: 'parti-oyunu-ws',
		configureServer(server) {
			if (server.httpServer) attachGameServer(server.httpServer);
		}
	};
}

export default defineConfig({
	plugins: [
		gameServerDevPlugin(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
