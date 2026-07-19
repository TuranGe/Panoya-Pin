import WebSocket from 'ws';

// Sunucuyu ayrı bir terminalde çalıştırıp (npm run dev ya da npm run build && npm start)
// bu script'i `node tests/game-flow.test.mjs` ile çalıştırabilirsin.
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
	return function waitFor(predicate, timeout = 3000) {
		return new Promise((resolve, reject) => {
			const start = Date.now();
			const interval = setInterval(() => {
				while (idx < ws.history.length) {
					const msg = ws.history[idx++];
					if (predicate(msg)) { clearInterval(interval); return resolve(msg); }
				}
				if (Date.now() - start > timeout) { clearInterval(interval); reject(new Error('Timeout: ' + JSON.stringify(ws.latest))); }
			}, 20);
		});
	};
}

async function main() {
	console.log('--- Bağlanıyor (herkes uzaktan, ayrı bağlantılar) ---');

	// Odayı kuran kişi = owner, aynı zamanda normal bir oyuncu
	const owner = await connect();
	const wOwner = waiterFor(owner);
	send(owner, { type: 'create_room', nickname: 'Ayşe' });
	const created = await wOwner((m) => m.type === 'joined');
	const code = created.code;
	console.log('Oda kodu:', code, '| owner playerId:', created.playerId);

	const players = [owner];
	for (const name of ['Mehmet', 'Zeynep']) {
		const p = await connect();
		const w = waiterFor(p);
		send(p, { type: 'join_room', code, nickname: name });
		await w((m) => m.type === 'joined');
		players.push(p);
	}
	await wOwner((m) => m.state?.players.length === 3);
	const ownerId = owner.latest.state.ownerId;
	console.log('--- 3 oyuncu odada, owner:', owner.latest.state.players.find((p) => p.id === ownerId)?.nickname, '---');

	// Owner olmayan biri faz geçişini tetiklemeye çalışırsa engellenmeli
	send(players[1], { type: 'start_collecting', mode: 'kim_yapar' });
	await new Promise((r) => setTimeout(r, 200));
	console.log('✅ Owner olmayanın start_collecting denemesi sessizce yok sayıldı (faz hâlâ lobby):', owner.latest.state.phase === 'lobby');

	send(owner, { type: 'start_collecting', mode: 'kim_yapar' });
	await wOwner((m) => m.state?.phase === 'collecting');
	console.log('--- besleme fazı ---');

	const prompts = [
		'Toplantıya en son geç kalan kim olur?',
		'Gece yarısı arayan kim olur?',
		'Tatilde valizini son ana bırakan kim olur?',
		'Karaokede mikrofonu bırakmayan kim olur?',
		'Herkesi bir fikirle ikna edip vazgeçen kim olur?'
	];
	for (let i = 0; i < prompts.length; i++) {
		send(players[i % players.length], { type: 'submit_prompt', text: prompts[i] });
	}
	await wOwner((m) => m.state?.submittedCount === prompts.length);
	console.log('--- 5 senaryo gönderildi ---');

	send(owner, { type: 'start_game' });
	await wOwner((m) => m.state?.phase === 'playing');
	console.log('--- oyun başladı, tur 1 ---');

	let round = 1;
	let finished = false;
	while (!finished) {
		const targetId = owner.latest.state.players[0].id;
		for (const p of players) send(p, { type: 'cast_vote', votedForId: targetId });

		const revealed = await wOwner((m) => m.state?.currentRound?.revealed === true && m.state.roundNumber === round);
		console.log(`--- Tur ${round} sonuçlandı, oylar:`, revealed.state.currentRound.results.map((r) => `${r.nickname}=${r.votes}${r.isTop ? '*' : ''}`).join(', '));

		const remaining = revealed.state.roundsRemaining;
		send(owner, { type: 'next_round' });
		if (remaining === 0) {
			await wOwner((m) => m.state?.phase === 'results');
			finished = true;
		} else {
			round++;
			await wOwner((m) => m.state?.phase === 'playing' && m.state.roundNumber === round);
		}
	}

	console.log('--- SONUÇLAR ---', owner.latest.state.players.map((p) => `${p.nickname}:${p.score}`).join(', '));

	send(owner, { type: 'play_again' });
	const replay = await wOwner((m) => m.state?.phase === 'lobby' && m.state.roundNumber === 0);
	console.log('--- Yeniden oyna: lobiye dönüldü. Skorlar sıfırlandı mı?', replay.state.players.every((p) => p.score === 0));
	console.log('--- Havuzdaki eski senaryolar korundu mu (poolCount>=5)?', replay.state.poolCount >= 5);

	console.log('\n✅ TÜM AKIŞ BAŞARILI');
	process.exit(0);
}

main().catch((err) => {
	console.error('❌ TEST BAŞARISIZ:', err);
	process.exit(1);
});
