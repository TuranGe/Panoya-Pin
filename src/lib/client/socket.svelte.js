import { browser } from '$app/environment';

const STORAGE_CODE = 'parti-oyunu:code';
const STORAGE_PLAYER_ID = 'parti-oyunu:playerId';
const STORAGE_NICKNAME = 'parti-oyunu:nickname';

function makeStore() {
	let ws = null;
	let queue = [];
	let reconnectTimer = null;
	let onJoined = null;

	const store = $state({
		connected: false,
		code: browser ? localStorage.getItem(STORAGE_CODE) : null,
		playerId: browser ? localStorage.getItem(STORAGE_PLAYER_ID) : null,
		nickname: browser ? localStorage.getItem(STORAGE_NICKNAME) || '' : '',
		game: null, // sunucudan gelen son state
		isOwner: false,
		myVote: null,
		isExcluded: false,
		myFakeSubmitted: false,
		error: null,
		kickedAt: null
	});

	function persist() {
		if (!browser) return;
		if (store.code) localStorage.setItem(STORAGE_CODE, store.code);
		if (store.playerId) localStorage.setItem(STORAGE_PLAYER_ID, store.playerId);
		if (store.nickname) localStorage.setItem(STORAGE_NICKNAME, store.nickname);
	}

	function clearSession() {
		store.code = null;
		store.playerId = null;
		store.game = null;
		store.isOwner = false;
		if (browser) {
			localStorage.removeItem(STORAGE_CODE);
			localStorage.removeItem(STORAGE_PLAYER_ID);
		}
	}

	function send(msg) {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		} else {
			queue.push(msg);
			ensureSocket();
		}
	}

	function ensureSocket() {
		if (!browser) return;
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		ws = new WebSocket(`${proto}://${location.host}/ws`);

		ws.onopen = () => {
			store.connected = true;
			store.error = null;
			// Bağlantı koptuysa (sayfa yenileme, uyku modu vb.) kaldığımız yerden devam et
			if (store.code && store.playerId) {
				ws.send(JSON.stringify({ type: 'rejoin', code: store.code, playerId: store.playerId }));
			}
			for (const msg of queue) ws.send(JSON.stringify(msg));
			queue = [];
		};

		ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			switch (msg.type) {
				case 'joined':
					store.code = msg.code;
					store.playerId = msg.playerId;
					persist();
					onJoined?.(msg.code);
					onJoined = null;
					break;
				case 'state':
					store.game = msg.state;
					store.myVote = msg.myVote ?? null;
					store.isOwner = !!msg.isOwner;
					store.isExcluded = !!msg.isExcluded;
					store.myFakeSubmitted = !!msg.myFakeSubmitted;
					break;
				case 'error':
					store.error = msg.message;
					if (msg.message === 'SESSION_NOT_FOUND') clearSession();
					break;
				case 'kicked':
					clearSession();
					store.error = 'Oda kurucusu seni bu odadan çıkardı.';
					store.kickedAt = Date.now();
					break;
			}
		};

		ws.onclose = () => {
			store.connected = false;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = setTimeout(() => ensureSocket(), 1500);
		};

		ws.onerror = () => {
			ws?.close();
		};
	}

	return {
		get state() {
			return store;
		},
		connect: ensureSocket,
		createRoom(nickname, onDone) {
			clearSession();
			store.nickname = nickname;
			persist();
			onJoined = onDone || null;
			send({ type: 'create_room', nickname });
		},
		joinRoom(code, nickname, onDone) {
			store.nickname = nickname;
			persist();
			onJoined = onDone || null;
			send({ type: 'join_room', code, nickname });
		},
		submitPrompt(promptType, text, answer) {
			send({ type: 'submit_prompt', promptType, text, answer });
		},
		submitFakeAnswer(text) {
			send({ type: 'submit_fake_answer', text });
		},
		startCollecting(mode) {
			send({ type: 'start_collecting', mode });
		},
		startGame() {
			send({ type: 'start_game' });
		},
		castVote(votedForId) {
			send({ type: 'cast_vote', votedForId });
		},
		nextRound() {
			send({ type: 'next_round' });
		},
		playAgain() {
			send({ type: 'play_again' });
		},
		transferOwnership(targetPlayerId) {
			send({ type: 'transfer_ownership', targetPlayerId });
		},
		kickPlayer(targetPlayerId) {
			send({ type: 'kick_player', targetPlayerId });
		},
		leave() {
			send({ type: 'leave' });
			clearSession();
		},
		/** Sayfadaki oda kodu, hafızadaki oturumdan farklıysa eski oturumu unut
		 *  (böylece yanlışlıkla eski odaya otomatik geri dönülmez). */
		forgetIfDifferentRoom(targetCode) {
			if (store.code && store.code !== targetCode) clearSession();
		},
		clearError() {
			store.error = null;
		}
	};
}

export const gameStore = makeStore();