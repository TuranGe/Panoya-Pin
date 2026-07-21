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
	return (predicate, timeout = 5000) => new Promise((resolve, reject) => {
		const start = Date.now();
		const iv = setInterval(() => {
			while (idx < ws.history.length) { const m = ws.history[idx++]; if (predicate(m)) { clearInterval(iv); return resolve(m); } }
			if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error('timeout')); }
		}, 20);
	});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
	const owner = await connect(); const wOwner = waiterFor(owner);
	send(owner, { type: 'create_room', nickname: 'A' });
	const created = await wOwner((m) => m.type === 'joined');
	const p2 = await connect(); const w2 = waiterFor(p2);
	send(p2, { type: 'join_room', code: created.code, nickname: 'B' });
	const j2 = await w2((m) => m.type === 'joined');
	const p3 = await connect(); const w3 = waiterFor(p3);
	send(p3, { type: 'join_room', code: created.code, nickname: 'C' });
	await w3((m) => m.type === 'joined');
	await wOwner((m) => m.state?.players.length === 3);

	send(owner, { type: 'start_collecting', mode: 'kim_yapar' });
	await wOwner((m) => m.state?.phase === 'collecting');
	for (const [i, p] of [owner, p2, p3].entries()) send(p, { type: 'submit_prompt', text: `s${i}` });
	await wOwner((m) => m.state?.submittedCount === 3);
	send(owner, { type: 'start_game' });
	await wOwner((m) => m.state?.phase === 'playing');

	// B kopuyor
	p2.close();
	await wOwner((m) => m.state?.players.find(p => p.nickname==='B')?.connected === false);

	// herkes (A, C) oy verir, B bağlı değil, süreyi beklemeden reveal tetiklenmeli mi? Hayır - allVoted sadece connected'lara bakıyor
	const targetId = owner.latest.state.players[0].id;
	send(owner, { type: 'cast_vote', votedForId: targetId });
	send(p3, { type: 'cast_vote', votedForId: targetId });
	const revealed = await wOwner((m) => m.state?.currentRound?.revealed === true);
	console.log('✅ B bağlı değilken A ve C oy verince tur otomatik açıldı (connected oyuncu sayısına göre)');

	// B şimdi reconnect ediyor (oyun 'playing' fazında VE round revealed) — bu, hatanın yaşandığı senaryo
	const p2b = await connect(); const w2b = waiterFor(p2b);
	send(p2b, { type: 'rejoin', code: created.code, playerId: j2.playerId });
	const rejoined = await w2b((m) => m.type === 'joined');
	const state = await w2b((m) => m.type === 'state');
	console.log('✅ Oyun başladıktan (playing fazında, round revealed) sonra reconnect BAŞARILI, sunucu hatasız state gönderdi.');
	console.log('   currentRound.results uzunluğu:', state.state.currentRound.results.length);

	console.log('\n✅ RECONNECT SENARYOSU BAŞARILI (sunucu tarafı)');
	process.exit(0);
}
main().catch((e) => { console.error('❌', e); process.exit(1); });
