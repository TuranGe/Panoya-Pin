import { WebSocketServer, WebSocket } from 'ws';
import {
	createRoom,
	getRoom,
	addPlayer,
	markDisconnected,
	clearOwnerGraceTimer,
	transferOwnership,
	removePlayer
} from './rooms.js';
import {
	addSubmission,
	beginCollecting,
	startGame,
	startNextRound,
	castVote,
	submitFakeAnswer,
	forceStartVoting,
	revealRound,
	resetForReplay,
	getPublicState,
	MIN_PLAYERS,
	MIN_POOL_TO_START,
	ROUND_DURATION_MS,
	VALID_MODES,
	VALID_ROUND_COUNTS
} from './gameLogic.js';

const MAX_NICKNAME = 20;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 40; // bir saniyede bir bağlantıdan gelebilecek en fazla mesaj

function safeSend(ws, payload) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(payload));
	}
}

function sendError(ws, message) {
	safeSend(ws, { type: 'error', message });
}

/** Basit sabit-pencereli hız sınırlama: bir bağlantı saniyede RATE_LIMIT_MAX_MESSAGES'tan
 *  fazla mesaj gönderirse, pencere dolana kadar fazlası sessizce yok sayılır. Tek bir hatalı/
 *  kötü niyetli istemcinin (ör. saniyede yüzlerce cast_vote göndererek) sunucuyu meşgul etmesini
 *  ya da diğer oyuncuların deneyimini bozmasını engeller. */
function isRateLimited(ws) {
	const now = Date.now();
	if (!ws._rateWindowStart || now - ws._rateWindowStart > RATE_LIMIT_WINDOW_MS) {
		ws._rateWindowStart = now;
		ws._rateCount = 0;
	}
	ws._rateCount += 1;
	return ws._rateCount > RATE_LIMIT_MAX_MESSAGES;
}

/** Belirtilen ws hariç, odadaki bağlı herkese küçük bir bildirim gönderir (ör. "X bağlantısı koptu"). */
function notifyOthers(room, payload, exceptWs) {
	for (const player of room.players.values()) {
		if (!player.connected) continue;
		if (player.ws === exceptWs) continue;
		safeSend(player.ws, payload);
	}
}

function broadcastRoom(room) {
	const state = getPublicState(room);
	const round = room.currentRound;
	for (const player of room.players.values()) {
		if (!player.connected) continue;
		const myVote = round ? round.votes.get(player.id) ?? null : null;
		const extra = {};
		if (round?.type === 'yalanci') {
			extra.isExcluded = round.authorId === player.id;
			extra.myFakeSubmitted = round.fakeAnswers.has(player.id);
		}
		safeSend(player.ws, {
			type: 'state',
			state,
			myPlayerId: player.id,
			myVote,
			isOwner: room.ownerId === player.id,
			...extra
		});
	}
}

function cleanNickname(raw) {
	return (raw || '').toString().trim().slice(0, MAX_NICKNAME) || 'Oyuncu';
}

// --- Tur zamanlayıcısı: süre dolduğunda oy/cevap vermeyenler boş geçmiş sayılır ---
function clearRoundTimer(room) {
	if (room.roundTimer) {
		clearTimeout(room.roundTimer);
		room.roundTimer = null;
	}
}

function scheduleRoundTimer(room) {
	clearRoundTimer(room);
	const round = room.currentRound;
	if (!round) return;
	const roundId = round.submissionId;

	if (round.type === 'yalanci' && round.subPhase === 'writing') {
		// Yazma süresi: dolunca oylamaya zorla geçilir, sonra oylama için yeni süre başlar
		room.roundTimer = setTimeout(() => {
			room.roundTimer = null;
			const r = room.currentRound;
			if (r && r.submissionId === roundId && r.type === 'yalanci' && r.subPhase === 'writing') {
				forceStartVoting(room);
				broadcastRoom(room);
				scheduleRoundTimer(room);
			}
		}, ROUND_DURATION_MS);
		return;
	}

	// kim_yapar oylaması ya da yalancı'nın oylama alt-fazı: süre dolunca doğrudan sonuçlandır
	room.roundTimer = setTimeout(() => {
		room.roundTimer = null;
		const r = room.currentRound;
		if (r && r.submissionId === roundId && !r.revealed) {
			revealRound(room);
			broadcastRoom(room);
		}
	}, ROUND_DURATION_MS);
}

function handleMessage(ws, msg) {
	switch (msg.type) {
		// --- Oda kurma / katılma: herkes uzaktan kendi cihazından oynar ---
		case 'create_room': {
			const room = createRoom();
			const player = addPlayer(room, { id: crypto.randomUUID(), nickname: cleanNickname(msg.nickname), ws });
			ws._roomCode = room.code;
			ws._playerId = player.id;
			safeSend(ws, { type: 'joined', code: room.code, playerId: player.id });
			broadcastRoom(room);
			break;
		}
		case 'join_room': {
			const room = getRoom(msg.code);
			if (!room) return sendError(ws, 'Böyle bir oda bulunamadı.');
			if (room.phase === 'playing' || room.phase === 'results') {
				return sendError(ws, 'Bu oyun zaten başladı, bir sonraki oyunda katılabilirsin.');
			}
			const player = addPlayer(room, { id: crypto.randomUUID(), nickname: cleanNickname(msg.nickname), ws });
			ws._roomCode = room.code;
			ws._playerId = player.id;
			safeSend(ws, { type: 'joined', code: room.code, playerId: player.id });
			broadcastRoom(room);
			break;
		}
		case 'rejoin': {
			const room = getRoom(msg.code);
			const player = room && room.players.get(msg.playerId);
			if (!room || !player) return sendError(ws, 'SESSION_NOT_FOUND');
			const wasDisconnected = !player.connected;
			player.ws = ws;
			player.connected = true;
			ws._roomCode = room.code;
			ws._playerId = player.id;
			if (room.ownerId === player.id) clearOwnerGraceTimer(room);
			safeSend(ws, { type: 'joined', code: room.code, playerId: player.id });
			if (wasDisconnected) {
				notifyOthers(room, { type: 'player_returned', nickname: player.nickname }, ws);
			}
			broadcastRoom(room);
			break;
		}
		case 'submit_prompt': {
			const room = getRoom(ws._roomCode);
			if (!room || !ws._playerId || room.phase === 'playing' || room.phase === 'results') return;
			const result = addSubmission(room, ws._playerId, {
				type: msg.promptType,
				text: msg.text,
				answer: msg.answer
			});
			if (!result.ok) return sendError(ws, result.error);
			safeSend(ws, { type: 'submitted' });
			broadcastRoom(room);
			break;
		}
		case 'submit_fake_answer': {
			const room = getRoom(ws._roomCode);
			if (!room || !ws._playerId || room.phase !== 'playing') return;
			const result = submitFakeAnswer(room, ws._playerId, msg.text);
			if (!result.ok) return sendError(ws, result.error || 'Cevap kaydedilemedi.');
			if (result.allWrote) scheduleRoundTimer(room); // yazma bitti, oylama için yeni süre başlat
			broadcastRoom(room);
			break;
		}
		case 'cast_vote': {
			const room = getRoom(ws._roomCode);
			if (!room || !ws._playerId || room.phase !== 'playing') return;
			const result = castVote(room, ws._playerId, msg.votedForId);
			if (!result.ok) return sendError(ws, result.error || 'Oy kaydedilemedi.');
			if (result.autoRevealed) clearRoundTimer(room);
			broadcastRoom(room);
			break;
		}

		// --- Yalnızca oda sahibinin (owner) tetikleyebileceği faz geçişleri ---
		case 'start_collecting': {
			const room = getRoom(ws._roomCode);
			if (!room || room.ownerId !== ws._playerId || room.phase !== 'lobby') return;
			if (room.players.size < MIN_PLAYERS) {
				return sendError(ws, `Başlamak için en az ${MIN_PLAYERS} oyuncu gerekiyor.`);
			}
			if (!VALID_MODES.includes(msg.mode)) {
				return sendError(ws, 'Önce bir oyun modu seç.');
			}
			beginCollecting(room, msg.mode, msg.maxRounds);
			broadcastRoom(room);
			break;
		}
		case 'start_game': {
			const room = getRoom(ws._roomCode);
			if (!room || room.ownerId !== ws._playerId || room.phase !== 'collecting') return;
			startGame(room);
			scheduleRoundTimer(room);
			broadcastRoom(room);
			break;
		}
		case 'next_round': {
			const room = getRoom(ws._roomCode);
			if (!room || room.ownerId !== ws._playerId || room.phase !== 'playing') return;
			if (!room.currentRound || !room.currentRound.revealed) return;
			startNextRound(room);
			scheduleRoundTimer(room);
			broadcastRoom(room);
			break;
		}
		case 'play_again': {
			const room = getRoom(ws._roomCode);
			if (!room || room.ownerId !== ws._playerId || room.phase !== 'results') return;
			resetForReplay(room);
			broadcastRoom(room);
			break;
		}
		case 'transfer_ownership': {
			const room = getRoom(ws._roomCode);
			if (!room || room.ownerId !== ws._playerId) return;
			const ok = transferOwnership(room, msg.targetPlayerId);
			if (!ok) return sendError(ws, 'Sahiplik devredilemedi (oyuncu bağlı değil).');
			broadcastRoom(room);
			break;
		}
		case 'kick_player': {
			const room = getRoom(ws._roomCode);
			if (!room || room.ownerId !== ws._playerId) return;
			if (msg.targetPlayerId === ws._playerId) return sendError(ws, 'Kendini odadan atamazsın.');
			const kicked = removePlayer(room, msg.targetPlayerId);
			if (kicked) {
				safeSend(kicked.ws, { type: 'kicked' });
				if (kicked.ws && kicked.ws.readyState === WebSocket.OPEN) kicked.ws.close();
				broadcastRoom(room);
			}
			break;
		}

		case 'leave': {
			const room = getRoom(ws._roomCode);
			if (room && ws._playerId) {
				const player = room.players.get(ws._playerId);
				markDisconnected(room, ws._playerId, () => broadcastRoom(room));
				if (player) notifyOthers(room, { type: 'player_left', nickname: player.nickname }, ws);
				broadcastRoom(room);
			}
			break;
		}
		default:
			sendError(ws, 'Bilinmeyen mesaj tipi.');
	}
}

/**
 * Verilen http.Server üzerine oyun WebSocket sunucusunu bağlar.
 * Hem `vite dev` (bkz. vite.config.js) hem de üretim server.js tarafından kullanılır.
 * @param {import('http').Server} httpServer
 */
export function attachGameServer(httpServer) {
	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (req, socket, head) => {
		let pathname;
		try {
			pathname = new URL(req.url, 'http://localhost').pathname;
		} catch {
			return;
		}
		if (pathname !== '/ws') return; // başka upgrade istekleri (ör. Vite HMR) dokunulmadan geçer

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	});

	wss.on('connection', (ws) => {
		ws.on('message', (raw) => {
			if (isRateLimited(ws)) return; // sessizce yok say — pencere kısa sürede kendini sıfırlıyor
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return sendError(ws, 'Geçersiz mesaj.');
			}
			try {
				handleMessage(ws, msg);
			} catch (err) {
				console.error('Oyun mesajı işlenirken hata:', err);
				sendError(ws, 'Sunucuda beklenmeyen bir hata oluştu.');
			}
		});

		ws.on('close', () => {
			const room = getRoom(ws._roomCode);
			if (!room || !ws._playerId) return;
			const player = room.players.get(ws._playerId);
			markDisconnected(room, ws._playerId, () => broadcastRoom(room));
			if (player) notifyOthers(room, { type: 'player_left', nickname: player.nickname }, ws);
			broadcastRoom(room);
		});
	});

	console.log('🎉 Oyun WebSocket sunucusu /ws yolunda hazır');
	return wss;
}

export { MIN_PLAYERS, MIN_POOL_TO_START };
