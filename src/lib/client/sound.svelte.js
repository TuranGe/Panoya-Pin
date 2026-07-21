import { browser } from '$app/environment';

const STORAGE_KEY = 'parti-oyunu:soundEnabled';

function makeSoundEngine() {
	let ctx = null;

	const state = $state({
		enabled: browser ? localStorage.getItem(STORAGE_KEY) !== 'off' : true
	});

	function getCtx() {
		if (!browser) return null;
		if (!ctx) {
			const AudioContextClass = window.AudioContext || window.webkitAudioContext;
			if (!AudioContextClass) return null;
			ctx = new AudioContextClass();
		}
		if (ctx.state === 'suspended') ctx.resume();
		return ctx;
	}

	/** Kısa, sentezlenmiş bir ton çalar (üçgen zarf: sessizden tepeye, tepeden sessize). */
	function tone(freq, startOffset, duration, type = 'sine', peak = 0.15) {
		if (!state.enabled) return;
		const c = getCtx();
		if (!c) return;
		try {
			const osc = c.createOscillator();
			const gain = c.createGain();
			osc.type = type;
			osc.frequency.value = freq;
			const t0 = c.currentTime + startOffset;
			gain.gain.setValueAtTime(0.0001, t0);
			gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
			gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
			osc.connect(gain);
			gain.connect(c.destination);
			osc.start(t0);
			osc.stop(t0 + duration + 0.03);
		} catch {
			// Web Audio bazı ortamlarda (ör. eski tarayıcılar) hata verebilir — sessizce yok say
		}
	}

	return {
		get enabled() {
			return state.enabled;
		},
		/** İlk kullanıcı etkileşiminde (tıklama vb.) çağrılmalı ki tarayıcı ses bağlamına izin versin. */
		unlock() {
			getCtx();
		},
		toggle() {
			state.enabled = !state.enabled;
			if (browser) localStorage.setItem(STORAGE_KEY, state.enabled ? 'on' : 'off');
			if (state.enabled) getCtx();
			return state.enabled;
		},
		/** Geri sayımın son saniyelerinde kısa bir tık. */
		tick() {
			tone(1046.5, 0, 0.05, 'square', 0.05);
		},
		/** Yeni tur başladığında yükselen iki nota. */
		roundStart() {
			tone(523.25, 0, 0.13, 'sine', 0.1);
			tone(783.99, 0.09, 0.16, 'sine', 0.1);
		},
		/** Sonuçlar açıldığında. */
		reveal() {
			tone(440, 0, 0.1, 'triangle', 0.11);
			tone(659.25, 0.09, 0.18, 'triangle', 0.11);
		},
		/** O turda puan kazanınca ufak bir "kazandın" sesi. */
		scorePoint() {
			tone(880, 0, 0.09, 'sine', 0.09);
			tone(1174.66, 0.06, 0.12, 'sine', 0.09);
		},
		/** Oyun bitiminde küçük bir fanfar. */
		winner() {
			const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
			notes.forEach((f, i) => tone(f, i * 0.11, 0.28, 'sine', 0.12));
		}
	};
}

export const sound = makeSoundEngine();
