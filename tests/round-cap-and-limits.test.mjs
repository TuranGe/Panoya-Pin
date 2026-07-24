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
	return { code: created.code, players };
}

// --- Tur sayısı sınırı: 5 tur seçilirse havuzda daha fazla içerik olsa bile oyun 5 turda bitmeli ---
async function testRoundCap() {
	const { players } = await setupRoom(['A', 'B', 'C']);
	const [a, b, c] = players;
	const wA = waiterFor(a);

	send(a, { type: 'start_collecting', mode: 'kim_yapar', maxRounds: 5 });
	await wA((m) => m.state?.phase === 'collecting');

	// Sadece 2 senaryo giriyoruz — havuz 5 turu karşılayacak şekilde otomatik tamamlanmalı
	send(a, { type: 'submit_prompt', text: 'senaryo 1' });
	send(b, { type: 'submit_prompt', text: 'senaryo 2' });
	await wA((m) => m.state?.submittedCount === 2);

	send(a, { type: 'start_game' });
	const started = await wA((m) => m.state?.phase === 'playing');
	console.log('✅ maxRounds=5 seçildiğinde havuz otomatik tamamlandı, poolCount:', started.state.poolCount, '(>=5 olmalı)');
	if (started.state.poolCount < 5) throw new Error('Havuz 5 turu karşılayacak kadar tamamlanmadı');

	let rounds = 0;
	while (true) {
		const st = a.latest.state;
		if (st.phase === 'results') break;
		rounds++;
		if (rounds > 10) throw new Error('Tur sayısı sınırı çalışmadı, 10 turu geçti');
		const targetId = st.players[0].id;
		for (const p of players) send(p, { type: 'cast_vote', votedForId: targetId });
		const revealed = await wA((m) => m.state?.currentRound?.revealed === true && m.state.roundNumber === rounds);
		send(a, { type: 'next_round' });
		if (revealed.state.roundsRemaining === 0) {
			await wA((m) => m.state?.phase === 'results');
		} else {
			await wA((m) => (m.state?.currentRound && m.state.roundNumber === rounds + 1) || m.state?.phase === 'results');
		}
	}
	console.log('✅ Oyun tam olarak 5 turda bitti (havuzda daha fazla içerik olmasına rağmen):', rounds === 5);
	if (rounds !== 5) throw new Error(`Beklenen 5 tur, gerçek: ${rounds}`);
}

// --- Hız sınırlama: bir bağlantıdan saniyede çok fazla mesaj gelirse fazlası yok sayılmalı ---
async function testRateLimit() {
	const { players } = await setupRoom(['A', 'B', 'C']);
	const [a] = players;
	const wA = waiterFor(a);

	send(a, { type: 'start_collecting', mode: 'kim_yapar', maxRounds: 5 });
	await wA((m) => m.state?.phase === 'collecting');

	// Aynı bağlantıdan, aynı anda 60 submit_prompt gönderiyoruz (gerçekçi bir oyuncu bunu yapmaz)
	for (let i = 0; i < 60; i++) {
		send(a, { type: 'submit_prompt', text: `spam ${i}` });
	}
	await sleep(500);
	const submitted = a.latest.state.submittedCount;
	console.log('✅ 60 hızlı mesajdan sadece bir kısmı işlendi, submittedCount:', submitted, '(60’tan az olmalı)');
	if (submitted >= 60) throw new Error('Hız sınırlama çalışmıyor, 60 mesajın tamamı işlendi');

	// Pencere sıfırlandıktan sonra yeni mesajlar yine işlenebilmeli
	await sleep(1100);
	send(a, { type: 'submit_prompt', text: 'pencere sıfırlandıktan sonra' });
	const afterWindow = await wA((m) => m.state?.submittedCount === submitted + 1, 3000);
	console.log('✅ Pencere sıfırlandıktan sonra yeni mesaj normal şekilde işlendi:', !!afterWindow);
}

async function main() {
	await testRoundCap();
	await testRateLimit();
	console.log('\n✅ TUR SINIRI VE HIZ SINIRLAMASI TESTLERİ BAŞARILI');
	process.exit(0);
}

main().catch((err) => {
	console.error('❌ TEST BAŞARISIZ:', err);
	process.exit(1);
});
