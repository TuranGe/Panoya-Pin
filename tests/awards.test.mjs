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

// --- Senaryo 1: sadece "Kim Yapar?" oynanan bir oyunda yalancı-kim ödülleri (liar/gullible) HİÇ çıkmamalı ---
async function testKimYaparOnlyAwards() {
	const { players } = await setupRoom(['A', 'B', 'C']);
	const [a, b, c] = players;
	const wA = waiterFor(a);

	send(a, { type: 'start_collecting', mode: 'kim_yapar' });
	await wA((m) => m.state?.phase === 'collecting');
	for (let i = 0; i < 4; i++) send(players[i % 3], { type: 'submit_prompt', text: `senaryo ${i}` });
	await wA((m) => m.state?.submittedCount === 4);
	send(a, { type: 'start_game' });
	await wA((m) => m.state?.phase === 'playing');

	while (true) {
		const st = a.latest.state;
		if (st.phase === 'results') break;
		const targetId = st.players[0].id;
		for (const p of players) send(p, { type: 'cast_vote', votedForId: targetId });
		const revealed = await wA((m) => m.state?.currentRound?.revealed === true);
		if (revealed.state.roundsRemaining === 0) {
			send(a, { type: 'next_round' });
			await wA((m) => m.state?.phase === 'results');
		} else {
			send(a, { type: 'next_round' });
			await wA((m) => m.state?.currentRound && !m.state.currentRound.revealed);
		}
	}

	const awards = a.latest.state.awards;
	console.log('--- Sadece Kim Yapar? oynanan oyunun ödülleri ---', awards.map((x) => x.title));
	const keys = awards.map((x) => x.key);
	if (keys.includes('liar') || keys.includes('gullible')) {
		throw new Error('Yalancı-Kim hiç oynanmadığı halde liar/gullible ödülü çıktı: ' + JSON.stringify(awards));
	}
	if (!keys.includes('icon')) throw new Error('Kim Yapar? oynandığı halde "İkon" ödülü çıkmadı');
	if (!keys.includes('detective')) throw new Error('"Dedektif" ödülü çıkmadı');
	if (!keys.includes('blacksheep')) throw new Error('"Kara Koyun" ödülü çıkmadı');
	console.log('✅ Beklenen ödüller var, Yalancı Kim moduna özel ödüller yok');
}

// --- Senaryo 2: karışık modda oynanan bir oyunda tüm ödül kategorileri çıkabilmeli ---
async function testMixedAwards() {
	const { players } = await setupRoom(['A', 'B', 'C']);
	const [a, b, c] = players;
	const wA = waiterFor(a);

	send(a, { type: 'start_collecting', mode: 'mixed' });
	await wA((m) => m.state?.phase === 'collecting');
	send(a, { type: 'submit_prompt', promptType: 'kim_yapar', text: 'senaryo 1' });
	send(b, { type: 'submit_prompt', promptType: 'kim_yapar', text: 'senaryo 2' });
	send(a, { type: 'submit_prompt', promptType: 'yalanci', text: 'A sorusu?', answer: 'Gerçek' });
	send(b, { type: 'submit_prompt', promptType: 'yalanci', text: 'B sorusu?', answer: 'Gerçek2' });
	await wA((m) => m.state?.submittedCount === 4);
	send(a, { type: 'start_game' });
	await wA((m) => m.state?.phase === 'playing');

	while (true) {
		const st = a.latest.state;
		if (st.phase === 'results') break;
		const round = st.currentRound;

		if (round.type === 'kim_yapar') {
			const targetId = st.players[0].id;
			for (const p of players) send(p, { type: 'cast_vote', votedForId: targetId });
			await wA((m) => m.state?.currentRound?.revealed === true);
		} else {
			// yalanci: askedBy hariç herkes yazsın, sonra yine hariç herkes rastgele oylasın (gerçeğe oy versin)
			if (round.subPhase === 'writing') {
				for (const [i, p] of players.entries()) {
					send(p, { type: 'submit_fake_answer', text: `sahte ${i}` });
				}
				await wA((m) => m.state?.currentRound?.subPhase === 'voting');
			}
			const options = a.latest.state.currentRound.options;
			for (const p of players) send(p, { type: 'cast_vote', votedForId: options[0].id });
			await wA((m) => m.state?.currentRound?.revealed === true);
		}

		const after = a.latest.state;
		if (after.roundsRemaining === 0) {
			send(a, { type: 'next_round' });
			await wA((m) => m.state?.phase === 'results');
		} else {
			send(a, { type: 'next_round' });
			await wA((m) => m.state?.currentRound);
		}
	}

	const awards = a.latest.state.awards;
	console.log('--- Karışık modda oynanan oyunun ödülleri ---', awards.map((x) => `${x.title}: ${x.nickname} (${x.description})`));
	const keys = awards.map((x) => x.key);
	for (const expected of ['icon', 'detective', 'blacksheep']) {
		if (!keys.includes(expected)) throw new Error(`"${expected}" ödülü beklenirken çıkmadı`);
	}
	// yalanci oynandığı için liar/gullible çıkma ihtimali yüksek ama kimse kandırılmamış olabilir; en azından hata vermemeli
	for (const a2 of awards) {
		if (!a2.nickname || !a2.title || !a2.description) throw new Error('Eksik alanlı ödül: ' + JSON.stringify(a2));
	}
	console.log('✅ Karışık modda ödüller tutarlı ve eksiksiz');
}

async function main() {
	await testKimYaparOnlyAwards();
	await testMixedAwards();
	console.log('\n✅ ÖDÜLLER TESTİ BAŞARILI');
	process.exit(0);
}

main().catch((err) => {
	console.error('❌ TEST BAŞARISIZ:', err);
	process.exit(1);
});
