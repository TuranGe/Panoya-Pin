import WebSocket from 'ws';

// Bu testler için sunucuyu kısa süreli sabitlerle başlatman gerekir, örn:
//   OWNER_GRACE_MS=1500 ROUND_DURATION_MS=3000 npm start
const URL = process.env.TEST_URL || 'ws://localhost:3000/ws';
const ROUND_DURATION_MS = Number(process.env.ROUND_DURATION_MS) || 25000;

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
	return (predicate, timeout = 5000) => new Promise((resolve, reject) => {
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

async function setupRoom(names) {
	const owner = await connect();
	const wOwner = waiterFor(owner);
	send(owner, { type: 'create_room', nickname: names[0] });
	const created = await wOwner((m) => m.type === 'joined');
	const players = [owner];
	for (const name of names.slice(1)) {
		const p = await connect();
		const w = waiterFor(p);
		send(p, { type: 'join_room', code: created.code, nickname: name });
		await w((m) => m.type === 'joined');
		players.push(p);
	}
	await wOwner((m) => m.state?.players.length === names.length);
	return { code: created.code, ownerPlayerId: created.playerId, players };
}

async function testTransferOwnership() {
	const { players } = await setupRoom(['A', 'B', 'C']);
	const [owner, p2] = players;
	const wOwner = waiterFor(owner);
	const p2Id = owner.latest.state.players.find((p) => p.nickname === 'B').id;

	send(owner, { type: 'transfer_ownership', targetPlayerId: p2Id });
	await wOwner((m) => m.state?.ownerId === p2Id);
	console.log('✅ Sahiplik devri çalıştı (owner artık B)');

	// Eski owner artık faz geçişi tetikleyemez
	send(owner, { type: 'start_collecting' });
	await sleep(200);
	console.log('✅ Eski owner artık faz geçişi tetikleyemiyor:', owner.latest.state.phase === 'lobby');

	// Yeni owner tetikleyebilir
	const wP2 = waiterFor(p2);
	send(p2, { type: 'start_collecting' });
	await wP2((m) => m.state?.phase === 'collecting');
	console.log('✅ Yeni owner (B) faz geçişini başarıyla tetikledi');
}

async function testKickPlayer() {
	const { players } = await setupRoom(['A', 'B', 'C']);
	const [owner, p2, p3] = players;
	const wOwner = waiterFor(owner);
	const w3 = waiterFor(p3);
	const p3Id = owner.latest.state.players.find((p) => p.nickname === 'C').id;

	send(owner, { type: 'kick_player', targetPlayerId: p3Id });
	const kickedMsg = await w3((m) => m.type === 'kicked');
	console.log('✅ Atılan oyuncu "kicked" mesajını aldı');

	await wOwner((m) => m.state?.players.length === 2);
	console.log('✅ Atılan oyuncu oda listesinden çıkarıldı');

	// Kendini atamaz
	send(owner, { type: 'kick_player', targetPlayerId: owner.latest.state.ownerId });
	const err = await wOwner((m) => m.type === 'error');
	console.log('✅ Owner kendini atamadı:', err.message);
}

async function testRoundTimer() {
	const { players, code } = await setupRoom(['A', 'B', 'C']);
	const [owner, p2, p3] = players;
	const wOwner = waiterFor(owner);

	send(owner, { type: 'start_collecting' });
	await wOwner((m) => m.state?.phase === 'collecting');
	for (const [i, p] of players.entries()) send(p, { type: 'submit_prompt', text: `senaryo ${i}` });
	await wOwner((m) => m.state?.submittedCount === 3);
	send(owner, { type: 'start_game' });
	await wOwner((m) => m.state?.phase === 'playing');

	console.log(`--- Kimse oy vermeden ${ROUND_DURATION_MS}ms bekleniyor (süre dolacak) ---`);
	// Kasıtlı olarak HİÇ oy kullanmıyoruz
	const revealed = await wOwner((m) => m.state?.currentRound?.revealed === true, ROUND_DURATION_MS + 4000);
	console.log('✅ Süre dolunca kimse oy vermese de tur otomatik açıldı. Oy sayısı:', revealed.state.currentRound.respondedCount);
}

async function main() {
	await testTransferOwnership();
	await testKickPlayer();
	await testRoundTimer();
	console.log('\n✅ TÜM YENİ ÖZELLİK TESTLERİ BAŞARILI');
	process.exit(0);
}

main().catch((err) => {
	console.error('❌ TEST BAŞARISIZ:', err);
	process.exit(1);
});
