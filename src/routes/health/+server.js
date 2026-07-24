import { json } from '@sveltejs/kit';
import { rooms } from '$lib/server/rooms.js';

// GET /health — deploy platformlarının "servis ayakta mı" kontrolü için.
// Hem `npm run dev` hem de üretim sunucusunda (adapter-node üzerinden) otomatik çalışır,
// server.js içinde ayrıca bir şey yapmaya gerek yok.
export function GET() {
	return json({
		status: 'ok',
		uptime: process.uptime(),
		rooms: rooms.size
	});
}
