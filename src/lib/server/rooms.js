// In-memory oda (room) deposu. Tek sunucu örneği için yeterli; büyütmek istersen
// bu Map'i Redis gibi paylaşılan bir depoya taşımak yeterli olur.

/** @type {Map<string, Room>} */
export const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilecek karakterler (O/0, I/1) çıkarıldı
const OWNER_GRACE_MS = Number(process.env.OWNER_GRACE_MS) || 15000; // owner bağlantısı koparsa (ör. sayfa yenileme) sahiplik hemen devrolmez, bu kadar beklenir

const PLAYER_COLORS = [
	'#FFC94A', // marker-yellow
	'#FF5D8F', // marker-pink
	'#6FE7B7', // marker-mint
	'#7FB2FF', // marker-blue
	'#C792FF', // marker-lilac
	'#FF9B5C', // marker-orange
	'#5CE1E6', // marker-cyan
	'#FF7A7A' // marker-red
];

function generateCode() {
	let code;
	do {
		code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
	} while (rooms.has(code));
	return code;
}

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} nickname
 * @property {string} color
 * @property {number} score
 * @property {boolean} connected
 * @property {any} ws
 * @property {PlayerStats} stats
 */

/**
 * @typedef {Object} PlayerStats
 * @property {number} kimYaparVotesReceived - Kim Yapar? turlarında toplam alınan oy
 * @property {number} kimYaparCorrect - Kim Yapar?'da çoğunlukla aynı kişiyi kaç kez seçti
 * @property {number} yalanciFooled - Yalancı Kim?'de sahte cevabıyla kaç kişiyi kandırdı
 * @property {number} yalanciCorrect - Yalancı Kim?'de gerçek cevabı kaç kez buldu
 * @property {number} yalanciTimesFooled - Yalancı Kim?'de kaç kez kandı
 * @property {number} bestRoundGain - Tek bir turda kazandığı en yüksek puan
 * @property {number} bestRoundNumber - O turun numarası
 */

/** Oyun sonu ödülleri için tutulan sayaçların temiz hâli. */
export function freshStats() {
	return {
		kimYaparVotesReceived: 0,
		kimYaparCorrect: 0,
		yalanciFooled: 0,
		yalanciCorrect: 0,
		yalanciTimesFooled: 0,
		bestRoundGain: 0,
		bestRoundNumber: 0
	};
}

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {number} createdAt
 * @property {string|null} ownerId
 * @property {ReturnType<typeof setTimeout>|null} ownerGraceTimer
 * @property {'lobby'|'collecting'|'playing'|'results'} phase
 * @property {'kim_yapar'|'yalanci'|'mixed'|null} selectedMode
 * @property {Map<string, Player>} players
 * @property {Submission[]} pool
 * @property {Set<string>} usedIds
 * @property {number} roundNumber
 * @property {object | null} currentRound
 */

export function createRoom() {
	const code = generateCode();
	/** @type {Room} */
	const room = {
		code,
		createdAt: Date.now(),
		ownerId: null,
		ownerGraceTimer: null,
		phase: 'lobby',
		selectedMode: null, // 'kim_yapar' | 'yalanci' | 'mixed' — beslemeyi başlatmadan önce owner seçer
		players: new Map(),
		pool: [],
		usedIds: new Set(),
		roundNumber: 0,
		currentRound: null
	};
	rooms.set(code, room);
	return room;
}

export function getRoom(code) {
	return rooms.get((code || '').toUpperCase());
}

export function addPlayer(room, { id, nickname, ws }) {
	const color = PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
	/** @type {Player} */
	const player = { id, nickname, color, score: 0, connected: true, ws, stats: freshStats() };
	room.players.set(id, player);
	if (!room.ownerId) room.ownerId = id; // odayı kuran ilk kişi sahibi olur
	return player;
}

/**
 * Bir oyuncunun bağlantısı koptuğunda çağrılır. Sahip (owner) koptuysa sahipliği
 * HEMEN devretmez — sayfa yenileme gibi kısa kesintilerde sahiplik kaybolmasın diye
 * bir miktar (OWNER_GRACE_MS) bekler, o süre içinde geri bağlanmazsa devreder.
 * @param {(room: import('./rooms.js').Room) => void} [onOwnerReassigned] - sahiplik gerçekten devrolursa çağrılır (broadcast tetiklemek için)
 */
export function markDisconnected(room, playerId, onOwnerReassigned) {
	const p = room.players.get(playerId);
	if (p) p.connected = false;

	if (room.ownerId === playerId) {
		if (room.ownerGraceTimer) clearTimeout(room.ownerGraceTimer);
		room.ownerGraceTimer = setTimeout(() => {
			room.ownerGraceTimer = null;
			const stillOwnerAndDisconnected = room.ownerId === playerId && !room.players.get(playerId)?.connected;
			if (stillOwnerAndDisconnected) {
				const nextOwner = [...room.players.values()].find((pl) => pl.connected);
				if (nextOwner) {
					room.ownerId = nextOwner.id;
					onOwnerReassigned?.(room);
				}
			}
		}, OWNER_GRACE_MS);
	}

	// Oda tamamen boşaldıysa bir süre sonra temizle
	const anyoneLeft = [...room.players.values()].some((pl) => pl.connected);
	if (!anyoneLeft) {
		setTimeout(() => {
			const stillEmpty = [...room.players.values()].every((pl) => !pl.connected);
			if (stillEmpty) rooms.delete(room.code);
		}, 1000 * 60 * 10); // 10 dakika sonra terk edilmiş oda temizlenir
	}
}

export function clearOwnerGraceTimer(room) {
	if (room.ownerGraceTimer) {
		clearTimeout(room.ownerGraceTimer);
		room.ownerGraceTimer = null;
	}
}

/** Sahiplik devri: yalnızca bağlı bir oyuncuya devredilebilir. */
export function transferOwnership(room, targetPlayerId) {
	const target = room.players.get(targetPlayerId);
	if (!target || !target.connected) return false;
	clearOwnerGraceTimer(room);
	room.ownerId = targetPlayerId;
	return true;
}

/** Bir oyuncuyu odadan tamamen çıkarır (kick). Owner kendini atamaz. */
export function removePlayer(room, playerId) {
	const player = room.players.get(playerId);
	if (!player) return null;
	room.players.delete(playerId);
	if (room.ownerId === playerId) {
		const nextOwner = [...room.players.values()].find((pl) => pl.connected);
		room.ownerId = nextOwner ? nextOwner.id : null;
	}
	return player;
}

export function connectedPlayers(room) {
	return [...room.players.values()].filter((p) => p.connected);
}
