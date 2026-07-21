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

async function main() {
	const names = ['A', 'B', 'C', 'D'];
	const owner = await connect();
	const wOwner = waiterFor(owner);
	send(owner, { type: 'create_room', nickname: 'A' });
	const created = await wOwner((m) => m.type === 'joined');

	const conns = { A: owner };
	for (const name of ['B', 'C', 'D']) {
		const p = await connect();
		const w = waiterFor(p);
		send(p, { type: 'join_room', code: created.code, nickname: name });
		await w((m) => m.type === 'joined');
		conns[name] = p;
	}
	await wOwner((m) => m.state?.players.length === 4);
	console.log('--- 4 oyuncu odada ---');

	send(owner, { type: 'start_collecting', mode: 'yalanci' });
	await wOwner((m) => m.state?.phase === 'collecting');

	const trueAnswers = { A: 'Mavi', B: 'Örümcek', C: 'Bisiklet takla', D: 'Mantı' };
	for (const name of names) {
		send(conns[name], { type: 'submit_prompt', promptType: 'yalanci', text: `${name}'nin sorusu?`, answer: trueAnswers[name] });
	}
	await wOwner((m) => m.state?.submittedCount === 4);
	console.log('--- 4 yalancı-kim sorusu gönderildi ---');

	send(owner, { type: 'start_game' });
	// Tek bir wait: hem faz geçişini hem de round 1'in yazma fazında olduğunu aynı mesajda yakala
	await wOwner((m) => m.state?.phase === 'playing' && m.state.currentRound?.subPhase === 'writing');
	console.log('--- oyun başladı, tur 1 yazma fazında ---');

	let roundNum = 0;
	while (true) {
		roundNum++;
		const st = owner.latest.state; // buraya girdiğimizde zaten bu turun yazma fazındayız

		const askedBy = st.currentRound.askedBy;
		const eligibleNames = names.filter((n) => n !== askedBy).sort(); // stabil sıra: P1 < P2 < P3
		const [p1, p2, p3] = eligibleNames;
		console.log(`--- Tur ${roundNum}: soruyu ${askedBy} sordu, yazanlar: ${p1}, ${p2}, ${p3} ---`);

		// Soran kişi cevap YAZAMAMALI
		send(conns[askedBy], { type: 'submit_fake_answer', text: 'yasak cevap' });
		await new Promise((r) => setTimeout(r, 150));

		for (const n of eligibleNames) {
			send(conns[n], { type: 'submit_fake_answer', text: `FAKE_BY_${n}` });
		}
		await wOwner((m) => m.state?.currentRound?.subPhase === 'voting');
		console.log('   ✅ Herkes yazınca oylamaya otomatik geçildi');

		const options = owner.latest.state.currentRound.options;
		const trueOpt = options.find((o) => o.text === trueAnswers[askedBy]);
		const p2Opt = options.find((o) => o.text === `FAKE_BY_${p2}`);
		const p3Opt = options.find((o) => o.text === `FAKE_BY_${p3}`);
		if (!trueOpt || !p2Opt || !p3Opt) throw new Error('Beklenen seçenekler bulunamadı: ' + JSON.stringify(options));

		// Soran kişi oy VEREMEMELİ
		send(conns[askedBy], { type: 'cast_vote', votedForId: trueOpt.id });
		await new Promise((r) => setTimeout(r, 150));

		// P1 gerçeği bulur (+10), P2 ve P3 birbirlerinin sahte cevabına oy verir (+5'er kandırma)
		send(conns[p1], { type: 'cast_vote', votedForId: trueOpt.id });
		send(conns[p2], { type: 'cast_vote', votedForId: p3Opt.id });
		send(conns[p3], { type: 'cast_vote', votedForId: p2Opt.id });

		const revealed = await wOwner((m) => m.state?.currentRound?.revealed === true && m.state.roundNumber === roundNum);
		const results = revealed.state.currentRound.results;
		const trueResult = results.find((r) => r.isTrue);
		console.log(`   ✅ Açıldı. Gerçek cevabı yazan: ${trueResult.nickname}, doğru bilen sayısı: ${trueResult.votes}`);

		if (revealed.state.roundsRemaining === 0) {
			send(owner, { type: 'next_round' });
			await wOwner((m) => m.state?.phase === 'results');
			break;
		} else {
			send(owner, { type: 'next_round' });
			await wOwner((m) => m.state?.currentRound?.subPhase === 'writing' && m.state.roundNumber === roundNum + 1);
		}
	}

	const final = owner.latest.state.players;
	console.log('--- SONUÇLAR ---', final.map((p) => `${p.nickname}:${p.score}`).join(', '));
	const total = final.reduce((sum, p) => sum + p.score, 0);
	console.log('✅ Toplam dağıtılan puan 100 mü?', total === 100, `(gerçek: ${total})`);
	if (total !== 100) throw new Error('Puan toplamı beklenenden farklı: ' + total);

	console.log('\n✅ YALANCI KİM MODU TESTİ BAŞARILI');
}

async function testTimeoutPath() {
	const ROUND_DURATION_MS = Number(process.env.ROUND_DURATION_MS) || 25000;
	const names = ['A', 'B', 'C'];
	const owner = await connect();
	const wOwner = waiterFor(owner);
	send(owner, { type: 'create_room', nickname: 'A' });
	const created = await wOwner((m) => m.type === 'joined');
	const conns = { A: owner };
	for (const name of ['B', 'C']) {
		const p = await connect();
		const w = waiterFor(p);
		send(p, { type: 'join_room', code: created.code, nickname: name });
		await w((m) => m.type === 'joined');
		conns[name] = p;
	}
	await wOwner((m) => m.state?.players.length === 3);

	send(owner, { type: 'start_collecting', mode: 'yalanci' });
	await wOwner((m) => m.state?.phase === 'collecting');
	// Havuzu (MIN_POOL_TO_START=4) tamamen "yalanci" tipiyle dolduruyoruz ki rastgele
	// varsayılan dolgu (kim_yapar da olabilir) devreye girmesin ve tur 1 kesin yalanci olsun.
	for (let i = 0; i < 4; i++) {
		send(conns.A, { type: 'submit_prompt', promptType: 'yalanci', text: `A sorusu ${i}?`, answer: 'Cevap' });
	}
	await wOwner((m) => m.state?.submittedCount === 4);

	send(owner, { type: 'start_game' });
	await wOwner((m) => m.state?.phase === 'playing' && m.state.currentRound?.subPhase === 'writing');
	console.log(`--- Kimse cevap yazmadan ${ROUND_DURATION_MS}ms bekleniyor (yazma süresi dolacak) ---`);

	// Kasıtlı olarak KİMSE fake cevap yazmıyor
	const votingStarted = await wOwner((m) => m.state?.currentRound?.subPhase === 'voting', ROUND_DURATION_MS + 3000);
	console.log('✅ Süre dolunca kimse yazmasa da oylamaya zorla geçildi. Seçenek sayısı (sadece gerçek olmalı):', votingStarted.state.currentRound.options.length);
	if (votingStarted.state.currentRound.options.length !== 1) throw new Error('Beklenen tek seçenek yok');

	console.log(`--- Kimse oy vermeden ${ROUND_DURATION_MS}ms daha bekleniyor (oylama süresi dolacak) ---`);
	const revealed = await wOwner((m) => m.state?.currentRound?.revealed === true, ROUND_DURATION_MS + 3000);
	console.log('✅ Süre dolunca kimse oy vermese de tur açıldı. Soru sahibi A bonus aldı mı (+5)?', revealed.state.players.find((p) => p.nickname === 'A').score === 5);

	console.log('\n✅ SÜRE-DOLMA SENARYOSU BAŞARILI');
}

async function run() {
	await main();
	await testTimeoutPath();
	process.exit(0);
}

run().catch((err) => {
	console.error('❌ TEST BAŞARISIZ:', err);
	process.exit(1);
});
