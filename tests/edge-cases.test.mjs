import WebSocket from 'ws';

const URL = process.env.TEST_URL || 'ws://localhost:3000/ws';

function connect() {
	return new Promise((resolve) => {
		const ws = new WebSocket(URL);
		ws.history = [];
		Object.defineProperty(ws, 'latest', { get() { return ws.history[ws.history.length - 1] ?? null; } });
		ws.on('message', (raw) => ws.history.push(JSON.parse(raw.toString())));
		ws.on('open', () => resolve(ws));
	});
}
function send(ws, msg) { ws.send(JSON.stringify(msg)); }
function waiterFor(ws) {
	let idx = 0;
	return (predicate, timeout = 3000) => new Promise((resolve, reject) => {
		const start = Date.now();
		const iv = setInterval(() => {
			while (idx < ws.history.length) {
				const msg = ws.history[idx++];
				if (predicate(msg)) { clearInterval(iv); return resolve(msg); }
			}
			if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error('timeout: ' + JSON.stringify(ws.latest))); }
		}, 20);
	});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	// --- Hata durumu: olmayan odaya katılma ---
	const stray = await connect();
	const wStray = waiterFor(stray);
	send(stray, { type: 'join_room', code: 'ZZZZ', nickname: 'Kayıp' });
	const err1 = await wStray((m) => m.type === 'error');
	console.log('✅ Olmayan oda hatası doğru döndü:', err1.message);

	// --- Oda kur (owner) + oyuncu ekle ---
	const owner = await connect();
	const wOwner = waiterFor(owner);
	send(owner, { type: 'create_room', nickname: 'Kurucu' });
	const created = await wOwner((m) => m.type === 'joined');
	const code = created.code;
	console.log('Oda:', code);

	const p1 = await connect();
	const w1 = waiterFor(p1);
	send(p1, { type: 'join_room', code, nickname: 'Test1' });
	const joined1 = await w1((m) => m.type === 'joined');
	const playerId = joined1.playerId;

	const p2 = await connect();
	const w2 = waiterFor(p2);
	send(p2, { type: 'join_room', code, nickname: 'Test2' });
	await w2((m) => m.type === 'joined');

	await wOwner((m) => m.state?.players.length === 3);

	// --- Yetersiz oyuncu ile başlatma denemesi (2 kişilik ayrı bir oda) ---
	const owner2 = await connect();
	const wOwner2 = waiterFor(owner2);
	send(owner2, { type: 'create_room', nickname: 'Yalnız Kurucu' });
	const room2 = await wOwner2((m) => m.type === 'joined');
	const onlyOne = await connect();
	send(onlyOne, { type: 'join_room', code: room2.code, nickname: 'Yalnız' });
	await sleep(200);
	send(owner2, { type: 'start_collecting' });
	const err2 = await wOwner2((m) => m.type === 'error');
	console.log('✅ Yetersiz oyuncu hatası doğru döndü:', err2.message);

	// --- Oyuncu bağlantısını koparıp rejoin ile geri dönme ---
	p1.close();
	await wOwner((m) => m.state?.players.find((pl) => pl.id === playerId)?.connected === false);
	console.log('✅ Kopan oyuncu "connected:false" olarak işaretlendi');

	const p1b = await connect();
	const w1b = waiterFor(p1b);
	send(p1b, { type: 'rejoin', code, playerId });
	await w1b((m) => m.type === 'joined');
	await wOwner((m) => m.state?.players.find((pl) => pl.id === playerId)?.connected === true);
	console.log('✅ Rejoin ile oyuncu tekrar "connected:true" oldu');

	// --- Owner sayfayı yeniler gibi hızlıca kopup geri dönerse sahiplik değişmemeli ---
	owner.close();
	await sleep(300); // kısa kesinti — grace period içinde
	const ownerReconnect = await connect();
	const wOwnerReconnect = waiterFor(ownerReconnect);
	send(ownerReconnect, { type: 'rejoin', code, playerId: created.playerId });
	await wOwnerReconnect((m) => m.type === 'joined');
	await wOwnerReconnect((m) => m.state?.ownerId === created.playerId);
	console.log('✅ Kısa kesinti sonrası (sayfa yenileme gibi) sahiplik AYNI kişide kaldı');

	// --- Owner kalıcı olarak ayrılırsa (grace period sonunda) sahiplik devrolmalı ---
	ownerReconnect.close();
	const graceMs = Number(process.env.OWNER_GRACE_MS) || 15000;
	await w1b((m) => m.state?.ownerId && m.state.ownerId !== created.playerId, graceMs + 3000);
	console.log('✅ Grace period sonunda owner kalıcı ayrılınca sahiplik başka oyuncuya devroldu');

	// --- Oyun başladıktan sonra yeni oyuncu katılamaz ---
	send(p1b, { type: 'start_collecting' });
	await w1b((m) => m.state?.phase === 'collecting');
	for (const [i, p] of [p1b, p2].entries()) send(p, { type: 'submit_prompt', text: `senaryo ${i}` });
	await w1b((m) => m.state?.submittedCount === 2);
	send(p1b, { type: 'start_game' });
	await w1b((m) => m.state?.phase === 'playing');

	const lateJoiner = await connect();
	const wLate = waiterFor(lateJoiner);
	send(lateJoiner, { type: 'join_room', code, nickname: 'Geç Kalan' });
	const err3 = await wLate((m) => m.type === 'error');
	console.log('✅ Oyun başladıktan sonra katılma engellendi:', err3.message);

	console.log('\n✅ TÜM UÇ DURUM TESTLERİ BAŞARILI');
	process.exit(0);
}

main().catch((err) => {
	console.error('❌ TEST BAŞARISIZ:', err);
	process.exit(1);
});
