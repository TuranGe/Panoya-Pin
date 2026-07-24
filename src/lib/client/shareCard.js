// Oyun sonunda kazananı ve ödülleri özetleyen, indirilebilir/paylaşılabilir bir PNG kart üretir.
// Tamamen Canvas API ile çiziliyor — dışarıdan görsel dosyası gerekmiyor.

const W = 1080;
const H = 1350;

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
	const words = text.split(' ');
	let line = '';
	let lines = [];
	for (const word of words) {
		const test = line ? `${line} ${word}` : word;
		if (ctx.measureText(test).width > maxWidth && line) {
			lines.push(line);
			line = word;
		} else {
			line = test;
		}
	}
	if (line) lines.push(line);
	lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
	return lines.length;
}

/**
 * @param {{code: string, winnerName: string, winnerColor: string, awards: Array<{emoji:string,title:string,nickname:string}>, players: Array<{nickname:string,score:number,color:string}>}} data
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawResultCard(data) {
	if (document.fonts?.ready) {
		try {
			await document.fonts.ready;
		} catch {
			// yazı tipi yüklenmesi beklenirken sorun olursa yine de devam et (sistem fontuna düşer)
		}
	}

	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d');

	// --- Zemin: site paletiyle aynı gradyan ---
	const grad = ctx.createLinearGradient(0, 0, W, H);
	grad.addColorStop(0, '#FFD23F');
	grad.addColorStop(0.45, '#FF8A3D');
	grad.addColorStop(1, '#FF3E7A');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, W, H);

	const ink = '#2B1B4D';
	const paper = '#FFFDF6';

	// --- Marka ---
	ctx.fillStyle = ink;
	ctx.font = "700 40px Caveat, cursive";
	ctx.textAlign = 'center';
	ctx.fillText('Panoya Pin', W / 2, 90);
	ctx.font = "700 22px Fredoka, sans-serif";
	ctx.fillText(`Oda ${data.code} · Oyun Bitti`, W / 2, 128);

	// --- Kazanan kartı ---
	const winnerCardY = 165;
	const winnerCardH = 260;
	ctx.save();
	ctx.translate(W / 2, winnerCardY + winnerCardH / 2);
	ctx.rotate(-0.012);
	ctx.translate(-W / 2, -(winnerCardY + winnerCardH / 2));
	ctx.fillStyle = ink;
	roundRect(ctx, W / 2 - 400 + 8, winnerCardY + 8, 800, winnerCardH, 28);
	ctx.fill();
	ctx.fillStyle = paper;
	roundRect(ctx, W / 2 - 400, winnerCardY, 800, winnerCardH, 28);
	ctx.fill();
	ctx.strokeStyle = ink;
	ctx.lineWidth = 5;
	roundRect(ctx, W / 2 - 400, winnerCardY, 800, winnerCardH, 28);
	ctx.stroke();

	ctx.fillStyle = ink;
	ctx.font = '64px sans-serif';
	ctx.fillText('🏆', W / 2, winnerCardY + 90);
	ctx.font = "600 26px Fredoka, sans-serif";
	ctx.globalAlpha = 0.75;
	ctx.fillText('BU GRUBUN EFSANESİ', W / 2, winnerCardY + 140);
	ctx.globalAlpha = 1;
	ctx.font = "800 64px Fredoka, sans-serif";
	ctx.fillStyle = data.winnerColor || ink;
	ctx.fillText(data.winnerName || '—', W / 2, winnerCardY + 215);
	ctx.restore();

	// --- Ödüller ---
	let y = winnerCardY + winnerCardH + 70;
	const awards = (data.awards || []).slice(0, 4);
	const cardW = 480;
	const cardH = 140;
	const gap = 24;
	const cols = 2;
	const gridW = cols * cardW + gap;
	const startX = W / 2 - gridW / 2;

	awards.forEach((a, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = startX + col * (cardW + gap);
		const cy = y + row * (cardH + gap);

		ctx.fillStyle = ink;
		roundRect(ctx, x + 6, cy + 6, cardW, cardH, 22);
		ctx.fill();
		ctx.fillStyle = paper;
		roundRect(ctx, x, cy, cardW, cardH, 22);
		ctx.fill();
		ctx.strokeStyle = ink;
		ctx.lineWidth = 4;
		roundRect(ctx, x, cy, cardW, cardH, 22);
		ctx.stroke();

		ctx.textAlign = 'left';
		ctx.font = '46px sans-serif';
		ctx.fillStyle = ink;
		ctx.fillText(a.emoji || '⭐', x + 24, cy + 62);

		ctx.font = "700 20px Fredoka, sans-serif";
		ctx.globalAlpha = 0.65;
		ctx.fillText(a.title || '', x + 90, cy + 42);
		ctx.globalAlpha = 1;
		ctx.font = "800 30px Fredoka, sans-serif";
		wrapText(ctx, a.nickname || '', x + 90, cy + 82, cardW - 110, 32);
		ctx.textAlign = 'center';
	});

	// --- Skor tablosu ---
	const scoreY = y + Math.ceil(awards.length / cols) * (cardH + gap) + 50;
	ctx.textAlign = 'left';
	ctx.fillStyle = ink;
	ctx.font = "700 24px Fredoka, sans-serif";
	ctx.globalAlpha = 0.75;
	ctx.fillText('SKOR TABLOSU', startX, scoreY);
	ctx.globalAlpha = 1;

	const rowH = 56;
	(data.players || []).slice(0, 5).forEach((p, i) => {
		const ry = scoreY + 30 + i * rowH;
		ctx.fillStyle = ink;
		ctx.font = "700 26px Fredoka, sans-serif";
		ctx.fillText(`${i + 1}`, startX, ry + 30);

		ctx.fillStyle = p.color || ink;
		ctx.beginPath();
		ctx.arc(startX + 50, ry + 20, 12, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = ink;
		ctx.lineWidth = 3;
		ctx.stroke();

		ctx.fillStyle = ink;
		ctx.font = "600 28px Fredoka, sans-serif";
		ctx.fillText(p.nickname, startX + 80, ry + 30);

		ctx.textAlign = 'right';
		ctx.font = "800 28px Fredoka, sans-serif";
		ctx.fillText(`${p.score}`, startX + gridW - 8, ry + 30);
		ctx.textAlign = 'left';
	});

	ctx.textAlign = 'center';
	ctx.globalAlpha = 0.7;
	ctx.font = "600 20px Fredoka, sans-serif";
	ctx.fillStyle = ink;
	ctx.fillText('panoya-pin — arkadaş grubunun kendi oyunu', W / 2, H - 40);
	ctx.globalAlpha = 1;

	return canvas;
}

/** Kartı oluşturup indirir; destekleniyorsa native paylaşım sayfasını (Web Share API) dener. */
export async function shareOrDownloadResultCard(data) {
	const canvas = await drawResultCard(data);
	return new Promise((resolve) => {
		canvas.toBlob(async (blob) => {
			if (!blob) return resolve(false);
			const file = new File([blob], 'panoya-pin-sonuc.png', { type: 'image/png' });
			if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
				try {
					await navigator.share({ files: [file], title: 'Panoya Pin', text: 'Oyun bitti, sonuçlara bak!' });
					return resolve(true);
				} catch {
					// kullanıcı paylaşımı iptal etti ya da desteklenmiyor — indirmeye düş
				}
			}
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'panoya-pin-sonuc.png';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			resolve(true);
		}, 'image/png');
	});
}
