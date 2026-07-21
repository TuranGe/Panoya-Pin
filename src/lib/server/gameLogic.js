import { DEFAULT_KIM_YAPAR_PROMPTS, DEFAULT_YALANCI_PROMPTS } from './seedPrompts.js';
import { freshStats } from './rooms.js';

export const MIN_PLAYERS = 3;
export const MIN_POOL_TO_START = 4;
export const ROUND_DURATION_MS = Number(process.env.ROUND_DURATION_MS) || 25000; // her (alt-)faz için süre
export const VALID_MODES = ['kim_yapar', 'yalanci', 'mixed'];

const POINTS_FOR_MATCH = 10; // Kim Yapar: çoğunlukla aynı kişiyi seçmek
const POINTS_FOR_BEING_ICONIC = 5; // Kim Yapar: en çok oyu alan kişi olmak
const POINTS_YALANCI_CORRECT = 10; // Yalancı Kim: gerçek cevabı bulmak
const POINTS_YALANCI_PER_FOOL = 5; // Yalancı Kim: sahte cevabınla birini kandırmak (oy başına)
const POINTS_YALANCI_AUTHOR_BONUS = 5; // Yalancı Kim: soruyu soran kişi için sabit bonus

const TRUE_OWNER = '__true__';

function shuffle(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function eligiblePlayers(room, round) {
	const connected = [...room.players.values()].filter((p) => p.connected);
	if (round?.type === 'yalanci' && round.authorId) {
		return connected.filter((p) => p.id !== round.authorId);
	}
	return connected;
}

function captureScores(room) {
	return new Map([...room.players.entries()].map(([id, p]) => [id, p.score]));
}

/** Bir tur açıldıktan sonra, o turda en çok puan kazanan oyuncuyu "Görkemli Tur" ödülü için not eder. */
function applyBestRoundGains(room, before) {
	for (const [id, player] of room.players.entries()) {
		const prev = before.get(id) ?? player.score;
		const gain = player.score - prev;
		if (gain > player.stats.bestRoundGain) {
			player.stats.bestRoundGain = gain;
			player.stats.bestRoundNumber = room.roundNumber;
		}
	}
}

// --- İçerik girişi ---

export function addSubmission(room, authorId, payload) {
	const type = payload?.type === 'yalanci' ? 'yalanci' : 'kim_yapar';

	if (room.selectedMode && room.selectedMode !== 'mixed' && type !== room.selectedMode) {
		return { ok: false, error: 'Bu oyunda seçilen mod bu içerik türüne izin vermiyor.' };
	}

	if (type === 'kim_yapar') {
		const clean = (payload?.text || '').trim().slice(0, 140);
		if (!clean) return { ok: false, error: 'Boş girdi gönderilemez.' };
		room.pool.push({ id: crypto.randomUUID(), type, text: clean, authorId, isDefault: false });
		return { ok: true };
	}

	const question = (payload?.text || '').trim().slice(0, 140);
	const answer = (payload?.answer || '').trim().slice(0, 80);
	if (!question) return { ok: false, error: 'Soru boş olamaz.' };
	if (!answer) return { ok: false, error: 'Gerçek cevap boş olamaz.' };
	room.pool.push({ id: crypto.randomUUID(), type, text: question, answer, authorId, isDefault: false });
	return { ok: true };
}

export function beginCollecting(room, mode) {
	room.selectedMode = mode;
	room.phase = 'collecting';
}

function defaultFillers(need, mode) {
	const kimYapar = DEFAULT_KIM_YAPAR_PROMPTS.map((text) => ({ type: 'kim_yapar', text }));
	const yalanci = DEFAULT_YALANCI_PROMPTS.map((q) => ({ type: 'yalanci', text: q.text, answer: q.answer }));
	let source;
	if (mode === 'kim_yapar') source = kimYapar;
	else if (mode === 'yalanci') source = yalanci;
	else source = [...kimYapar, ...yalanci];
	return shuffle(source)
		.slice(0, need)
		.map((f) => ({
			id: crypto.randomUUID(),
			type: f.type,
			text: f.text,
			answer: f.answer,
			authorId: null,
			isDefault: true
		}));
}

export function startGame(room) {
	if (room.pool.length < MIN_POOL_TO_START) {
		room.pool.push(...defaultFillers(MIN_POOL_TO_START - room.pool.length, room.selectedMode));
	}
	room.pool = shuffle(room.pool);
	room.phase = 'playing';
	room.roundNumber = 0;
	room.currentRound = null;
	startNextRound(room);
}

export function startNextRound(room) {
	const next = room.pool.find((p) => !room.usedIds.has(p.id));
	if (!next) {
		room.phase = 'results';
		room.currentRound = null;
		return;
	}
	room.usedIds.add(next.id);
	room.roundNumber += 1;

	if (next.type === 'yalanci') {
		room.currentRound = {
			type: 'yalanci',
			submissionId: next.id,
			text: next.text, // soru
			trueAnswer: next.answer,
			authorId: next.authorId,
			subPhase: 'writing',
			fakeAnswers: new Map(), // playerId -> sahte cevap metni
			optionTokens: null, // oylama başlayınca dolar: Map<token, ownerId>
			votes: new Map(), // voterId -> token
			revealed: false,
			startedAt: Date.now()
		};
	} else {
		room.currentRound = {
			type: 'kim_yapar',
			submissionId: next.id,
			text: next.text,
			votes: new Map(), // voterId -> votedForPlayerId
			revealed: false,
			startedAt: Date.now()
		};
	}
}

// --- Yalancı Kim: sahte cevap yazma ---

function startVotingSubPhase(round) {
	round.subPhase = 'voting';
	const ownerIds = shuffle([TRUE_OWNER, ...round.fakeAnswers.keys()]);
	round.optionTokens = new Map(ownerIds.map((ownerId) => [crypto.randomUUID(), ownerId]));
	round.votingStartedAt = Date.now();
}

export function submitFakeAnswer(room, playerId, text) {
	const round = room.currentRound;
	if (!round || round.type !== 'yalanci' || round.subPhase !== 'writing') return { ok: false };
	if (round.authorId === playerId) return { ok: false, error: 'Bu senin sorduğun soru, cevap yazamazsın.' };
	const clean = (text || '').trim().slice(0, 80);
	if (!clean) return { ok: false, error: 'Boş cevap gönderilemez.' };
	round.fakeAnswers.set(playerId, clean);

	const eligible = eligiblePlayers(room, round).map((p) => p.id);
	const allWrote = eligible.length > 0 && eligible.every((id) => round.fakeAnswers.has(id));
	if (allWrote) startVotingSubPhase(round);
	return { ok: true, allWrote };
}

/** Süre dolunca yazma aşamasını zorla kapatır (kim yazmadıysa havuzda o cevap olmaz). */
export function forceStartVoting(room) {
	const round = room.currentRound;
	if (!round || round.type !== 'yalanci' || round.subPhase !== 'writing') return;
	startVotingSubPhase(round);
}

// --- Oylama (her iki mod da aynı mesaj tipini kullanır) ---

export function castVote(room, voterId, votedForId) {
	const round = room.currentRound;
	if (!round || round.revealed) return { ok: false };
	if (round.type === 'yalanci') return castVoteYalanci(room, round, voterId, votedForId);
	return castVoteKimYapar(room, round, voterId, votedForId);
}

function castVoteKimYapar(room, round, voterId, votedForId) {
	if (!room.players.has(votedForId)) return { ok: false, error: 'Geçersiz oyuncu.' };
	round.votes.set(voterId, votedForId);
	const eligible = eligiblePlayers(room, round).map((p) => p.id);
	const allVoted = eligible.every((id) => round.votes.has(id));
	if (allVoted) revealRound(room);
	return { ok: true, autoRevealed: allVoted };
}

function castVoteYalanci(room, round, voterId, token) {
	if (round.subPhase !== 'voting') return { ok: false, error: 'Henüz oylama başlamadı.' };
	if (round.authorId === voterId) return { ok: false, error: 'Bu senin sorun, oy veremezsin.' };
	const ownerId = round.optionTokens.get(token);
	if (!ownerId) return { ok: false, error: 'Geçersiz seçim.' };
	if (ownerId === voterId) return { ok: false, error: 'Kendi cevabına oy veremezsin.' };
	round.votes.set(voterId, token);
	const eligible = eligiblePlayers(room, round).map((p) => p.id);
	const allVoted = eligible.every((id) => round.votes.has(id));
	if (allVoted) revealRound(room);
	return { ok: true, autoRevealed: allVoted };
}

// --- Sonuçlandırma ---

export function revealRound(room) {
	const round = room.currentRound;
	if (!round || round.revealed) return;
	if (round.type === 'yalanci') return revealYalanciRound(room, round);
	return revealKimYaparRound(room, round);
}

function revealKimYaparRound(room, round) {
	round.revealed = true;
	const before = captureScores(room);

	const tally = new Map();
	for (const votedForId of round.votes.values()) {
		tally.set(votedForId, (tally.get(votedForId) || 0) + 1);
	}
	let topCount = 0;
	for (const count of tally.values()) topCount = Math.max(topCount, count);
	const topPlayerIds = new Set([...tally.entries()].filter(([, c]) => c === topCount).map(([id]) => id));

	for (const [voterId, votedForId] of round.votes.entries()) {
		const voter = room.players.get(voterId);
		if (voter && topPlayerIds.has(votedForId)) {
			voter.score += POINTS_FOR_MATCH;
			voter.stats.kimYaparCorrect += 1;
		}
	}
	for (const id of topPlayerIds) {
		const p = room.players.get(id);
		if (p) p.score += POINTS_FOR_BEING_ICONIC;
	}
	// Turu kazanmasa da, kime kaç oy geldiği "İkon" ödülü için ayrıca birikir
	for (const [playerId, count] of tally.entries()) {
		const p = room.players.get(playerId);
		if (p) p.stats.kimYaparVotesReceived += count;
	}

	round.tally = tally;
	round.topPlayerIds = topPlayerIds;
	applyBestRoundGains(room, before);
}

function revealYalanciRound(room, round) {
	if (round.subPhase === 'writing') startVotingSubPhase(round);
	round.revealed = true;
	const before = captureScores(room);

	/** @type {Map<string, number>} ownerId -> oy sayısı */
	const tally = new Map();
	for (const token of round.votes.values()) {
		const ownerId = round.optionTokens.get(token);
		if (ownerId) tally.set(ownerId, (tally.get(ownerId) || 0) + 1);
	}

	for (const [voterId, token] of round.votes.entries()) {
		const ownerId = round.optionTokens.get(token);
		const voter = room.players.get(voterId);
		if (ownerId === TRUE_OWNER) {
			if (voter) {
				voter.score += POINTS_YALANCI_CORRECT;
				voter.stats.yalanciCorrect += 1;
			}
		} else if (voter) {
			voter.stats.yalanciTimesFooled += 1;
		}
	}
	for (const fakerId of round.fakeAnswers.keys()) {
		const fooled = tally.get(fakerId) || 0;
		if (fooled > 0) {
			const faker = room.players.get(fakerId);
			if (faker) {
				faker.score += fooled * POINTS_YALANCI_PER_FOOL;
				faker.stats.yalanciFooled += fooled;
			}
		}
	}
	if (round.authorId) {
		const author = room.players.get(round.authorId);
		if (author) author.score += POINTS_YALANCI_AUTHOR_BONUS;
	}

	round.tally = tally;
	applyBestRoundGains(room, before);
}

export function resetForReplay(room) {
	room.phase = 'lobby';
	room.selectedMode = null;
	room.roundNumber = 0;
	room.usedIds = new Set();
	room.currentRound = null;
	for (const p of room.players.values()) {
		p.score = 0;
		p.stats = freshStats();
	}
	// room.pool bilerek temizlenmiyor: grubun girdiği içerikler bir sonraki oyunda da kullanılabilsin
}

export function roundsRemaining(room) {
	return room.pool.filter((p) => !room.usedIds.has(p.id)).length;
}

// --- Oyun sonu ödülleri ---

/** Oyun boyunca oynanmış turların türlerine göre en yüksek istatistiğe sahip oyuncuyu bulur. */
function topBy(players, statFn, min = 1) {
	let best = null;
	for (const p of players) {
		const v = statFn(p.stats);
		if (v >= min && (!best || v > statFn(best.stats))) best = p;
	}
	return best;
}

export function computeAwards(room) {
	const players = [...room.players.values()];
	if (players.length === 0) return [];

	const playedTypes = new Set(room.pool.filter((p) => room.usedIds.has(p.id)).map((p) => p.type));
	const kimYaparPlayed = playedTypes.has('kim_yapar');
	const yalanciPlayed = playedTypes.has('yalanci');

	const awards = [];

	if (kimYaparPlayed) {
		const icon = topBy(players, (s) => s.kimYaparVotesReceived);
		if (icon) {
			awards.push({
				key: 'icon',
				emoji: '🎯',
				title: 'İkon',
				nickname: icon.nickname,
				color: icon.color,
				description: `Kim Yapar? turlarında toplam ${icon.stats.kimYaparVotesReceived} oy aldı`
			});
		}
	}

	if (yalanciPlayed) {
		const liar = topBy(players, (s) => s.yalanciFooled);
		if (liar) {
			awards.push({
				key: 'liar',
				emoji: '🎭',
				title: 'En İyi Yalancı',
				nickname: liar.nickname,
				color: liar.color,
				description: `Sahte cevaplarıyla ${liar.stats.yalanciFooled} kişiyi kandırdı`
			});
		}

		const gullible = topBy(players, (s) => s.yalanciTimesFooled);
		if (gullible) {
			awards.push({
				key: 'gullible',
				emoji: '😅',
				title: 'En Kolay Kanan',
				nickname: gullible.nickname,
				color: gullible.color,
				description: `${gullible.stats.yalanciTimesFooled} kez sahte cevaba kandı`
			});
		}
	}

	const detective = topBy(players, (s) => s.kimYaparCorrect + s.yalanciCorrect);
	if (detective) {
		awards.push({
			key: 'detective',
			emoji: '🔍',
			title: 'Dedektif',
			nickname: detective.nickname,
			color: detective.color,
			description: `${detective.stats.kimYaparCorrect + detective.stats.yalanciCorrect} kez gerçeği/çoğunluğu buldu`
		});
	}

	if (players.length > 1) {
		const blackSheep = [...players].sort((a, b) => a.score - b.score)[0];
		awards.push({
			key: 'blacksheep',
			emoji: '🐑',
			title: 'Kara Koyun',
			nickname: blackSheep.nickname,
			color: blackSheep.color,
			description: `${blackSheep.score} puanla listeyi kapattı`
		});
	}

	const bestRound = topBy(players, (s) => s.bestRoundGain);
	if (bestRound) {
		awards.push({
			key: 'bestround',
			emoji: '⚡',
			title: 'Görkemli Tur',
			nickname: bestRound.nickname,
			color: bestRound.color,
			description: `Tur ${bestRound.stats.bestRoundNumber}'de tek seferde ${bestRound.stats.bestRoundGain} puan kazandı`
		});
	}

	return awards;
}

// --- Dışa açık (client'a giden) state ---

function serializeCurrentRound(room) {
	const r = room.currentRound;
	if (!r) return null;

	if (r.type === 'kim_yapar') {
		const base = {
			type: 'kim_yapar',
			text: r.text,
			revealed: r.revealed,
			respondedCount: r.votes.size,
			totalEligible: eligiblePlayers(room, r).length,
			endsAt: r.startedAt + ROUND_DURATION_MS
		};
		if (r.revealed) {
			base.results = [...room.players.values()].map((p) => ({
				id: p.id,
				nickname: p.nickname,
				color: p.color,
				votes: r.tally.get(p.id) || 0,
				isTop: r.topPlayerIds.has(p.id)
			}));
		}
		return base;
	}

	// yalanci
	const askedBy = r.authorId ? room.players.get(r.authorId)?.nickname ?? null : null;
	const eligibleCount = eligiblePlayers(room, r).length;
	const base = {
		type: 'yalanci',
		text: r.text, // soru
		askedBy,
		subPhase: r.subPhase,
		revealed: r.revealed
	};

	if (r.subPhase === 'writing' && !r.revealed) {
		base.respondedCount = r.fakeAnswers.size;
		base.totalEligible = eligibleCount;
		base.endsAt = r.startedAt + ROUND_DURATION_MS;
		return base;
	}

	// subPhase 'voting' ya da revealed=true: seçenekler (token bazlı, kimlik gizli) gösterilir
	base.respondedCount = r.votes.size;
	base.totalEligible = eligibleCount;
	base.endsAt = (r.votingStartedAt ?? r.startedAt) + ROUND_DURATION_MS;
	base.options = [...r.optionTokens.entries()].map(([token, ownerId]) => ({
		id: token,
		text: ownerId === TRUE_OWNER ? r.trueAnswer : r.fakeAnswers.get(ownerId)
	}));

	if (r.revealed) {
		base.results = [...r.optionTokens.entries()].map(([token, ownerId]) => {
			const isTrue = ownerId === TRUE_OWNER;
			const ownerPlayer = isTrue ? (r.authorId ? room.players.get(r.authorId) : null) : room.players.get(ownerId);
			return {
				id: token,
				text: isTrue ? r.trueAnswer : r.fakeAnswers.get(ownerId),
				isTrue,
				nickname: isTrue ? (ownerPlayer ? ownerPlayer.nickname : 'Hazır Soru') : (ownerPlayer?.nickname ?? 'Bilinmiyor'),
				color: ownerPlayer?.color,
				votes: r.tally.get(ownerId) || 0
			};
		});
	}

	return base;
}

export function getPublicState(room) {
	const players = [...room.players.values()]
		.sort((a, b) => b.score - a.score)
		.map((p) => ({ id: p.id, nickname: p.nickname, color: p.color, score: p.score, connected: p.connected }));

	return {
		code: room.code,
		phase: room.phase,
		ownerId: room.ownerId,
		selectedMode: room.selectedMode,
		players,
		poolCount: room.pool.length,
		submittedCount: room.pool.filter((p) => !p.isDefault).length,
		roundNumber: room.roundNumber,
		roundsRemaining: roundsRemaining(room),
		currentRound: serializeCurrentRound(room),
		awards: room.phase === 'results' ? computeAwards(room) : null
	};
}
