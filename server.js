// Üretim sunucusu. `npm run build` sonrası `npm start` ile çalıştırılır.
// SvelteKit'in adapter-node çıktısını (build/handler.js) düz bir http.Server'a
// bağlayıp aynı sunucu üzerinde oyunun WebSocket bağlantısını (/ws) da açıyoruz.
// Tek sunuculu bir kurulum (Railway, Fly.io, Render, kendi VPS'in vb.) için uygundur;
// WebSocket + bellek-içi oda durumu kullandığından sunucusuz (serverless) platformlar
// yerine sürekli çalışan bir Node süreci gerektirir.
import { createServer } from 'http';
import { handler } from './build/handler.js';
import { attachGameServer } from './src/lib/server/wsServer.js';

const port = process.env.PORT || 3000;

const server = createServer((req, res) => {
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

attachGameServer(server);

server.listen(port, () => {
	console.log(`✅ Sunucu hazır: http://localhost:${port}`);
});
