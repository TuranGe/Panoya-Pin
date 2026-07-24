<script>
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { gameStore } from '$lib/client/socket.svelte.js';
	import { sound } from '$lib/client/sound.svelte.js';
	import confetti from 'canvas-confetti';
	import AnimatedScore from '$lib/components/AnimatedScore.svelte';
	import LoadingDots from '$lib/components/LoadingDots.svelte';
	import { shareOrDownloadResultCard } from '$lib/client/shareCard.js';

	const store = gameStore.state;
	const code = page.params.code.toUpperCase();

	let nickname = $state(store.nickname || '');
	let joining = $state(false);
	let selectedMode = $state(null); // owner'ın lobide seçtiği mod: 'kim_yapar' | 'yalanci' | 'mixed'
	let selectedRounds = $state(null); // 5 | 10 | 15 | null ("Tümü")
	let promptType = $state('kim_yapar'); // sadece 'mixed' modda kullanılan besleme sekmesi
	let promptText = $state('');
	let promptAnswer = $state('');
	let fakeAnswerText = $state('');
	let mySubmissions = $state([]);
	let linkCopied = $state(false);
	let now = $state(Date.now());
	let pageHidden = $state(false);

	onMount(() => {
		gameStore.forgetIfDifferentRoom(code);
		gameStore.connect();
		const timer = setInterval(() => (now = Date.now()), 1000);

		const handleVisibility = () => (pageHidden = document.hidden);
		document.addEventListener('visibilitychange', handleVisibility);
		pageHidden = document.hidden;

		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	});

	// Oyuncu odadan atıldıysa ana sayfaya dön (hata mesajı orada gösterilir).
	$effect(() => {
		if (store.kickedAt) goto('/');
	});

	const joined = $derived(store.code === code && !!store.playerId);
	const game = $derived(store.game);
	const me = $derived(game?.players.find((p) => p.id === store.playerId));
	const isOwner = $derived(store.isOwner);
	const MIN_PLAYERS_NOTE = 3;

	// Mod 'mixed' değilse besleme formu doğrudan o türe kilitlenir (sekme gösterilmez).
	const effectiveType = $derived(
		game?.selectedMode && game.selectedMode !== 'mixed' ? game.selectedMode : promptType
	);

	// Svelte 5'te template içinde reaktif bir diziyi doğrudan .sort() ile mutasyona
	// uğratmak yasak (state_unsafe_mutation hatası) — bu yüzden kopyasını burada sıralıyoruz.
	const sortedResults = $derived(
		game?.currentRound?.revealed && game.currentRound.type === 'kim_yapar'
			? [...game.currentRound.results].sort((a, b) => b.votes - a.votes)
			: []
	);
	const notRespondedCount = $derived(
		game?.currentRound ? Math.max(0, game.currentRound.totalEligible - game.currentRound.respondedCount) : 0
	);
	const secondsLeft = $derived(
		game?.currentRound && !game.currentRound.revealed
			? Math.max(0, Math.ceil((game.currentRound.endsAt - now) / 1000))
			: null
	);

	// Sırası gelip henüz katılmamış mı? (oy vermedi / sahte cevap yazmadı, ve dışlanmış değil)
	const needsResponse = $derived.by(() => {
		if (!game || game.phase !== 'playing' || !game.currentRound || game.currentRound.revealed) return false;
		if (game.currentRound.type === 'kim_yapar') return store.myVote === null;
		if (store.isExcluded) return false;
		if (game.currentRound.subPhase === 'writing') return !store.myFakeSubmitted;
		return store.myVote === null;
	});

	// Sekme arka plandayken sırası gelen oyuncunun kaçırmaması için başlığı yanıp söndürür.
	let titleFlashTimer = null;
	const baseTitle = `${code} — Panoya Pin`;
	$effect(() => {
		if (needsResponse && pageHidden) {
			if (titleFlashTimer) return;
			let on = false;
			titleFlashTimer = setInterval(() => {
				document.title = on ? baseTitle : '🔴 Sıra sende! — Panoya Pin';
				on = !on;
			}, 1000);
		} else if (titleFlashTimer) {
			clearInterval(titleFlashTimer);
			titleFlashTimer = null;
			document.title = baseTitle;
		}
	});

	// --- Ses efektleri ve konfeti: oyun akışındaki geçişleri izleyip tetikler ---
	function prefersReducedMotion() {
		return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	}

	function fireMiniConfetti() {
		if (prefersReducedMotion()) return;
		confetti({
			particleCount: 26,
			spread: 55,
			startVelocity: 26,
			origin: { y: 0.7 },
			scalar: 0.8,
			colors: ['#FFD23F', '#FF3E7A', '#3DDC84']
		});
	}

	function fireWinnerConfetti(color) {
		if (prefersReducedMotion()) return;
		const colors = [color, '#FFD23F', '#FF3E7A', '#3DDC84', '#3E8EFF'].filter(Boolean);
		confetti({ particleCount: 90, spread: 100, startVelocity: 38, origin: { y: 0.4 }, colors });
		const end = Date.now() + 700;
		(function frame() {
			confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0 }, colors });
			confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1 }, colors });
			if (Date.now() < end) requestAnimationFrame(frame);
		})();
	}

	let scoreInitialized = false;
	let lastScore = 0;
	let lastRoundKey = null;
	let lastRevealed = false;
	let lastTickSecond = null;
	let resultsCelebrated = false;

	// Kendi puanın artınca (tur sırasında) ufak bir ses + konfeti
	$effect(() => {
		if (!me) return;
		if (!scoreInitialized) {
			scoreInitialized = true;
			lastScore = me.score;
			return;
		}
		if (me.score > lastScore && game?.phase === 'playing') {
			sound.scorePoint();
			fireMiniConfetti();
		}
		lastScore = me.score;
	});

	// Yeni tur başladığında
	$effect(() => {
		if (game?.phase !== 'playing' || !game.currentRound) return;
		if (game.roundNumber !== lastRoundKey) {
			lastRoundKey = game.roundNumber;
			sound.roundStart();
		}
	});

	// Sonuçlar açıldığında
	$effect(() => {
		const revealed = game?.currentRound?.revealed ?? false;
		if (revealed && !lastRevealed) sound.reveal();
		lastRevealed = revealed;
	});

	// Son 5 saniyede tık sesi
	$effect(() => {
		if (secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 5 && secondsLeft !== lastTickSecond) {
			lastTickSecond = secondsLeft;
			sound.tick();
		}
		if (secondsLeft === null) lastTickSecond = null;
	});

	// Oyun bitince fanfar + konfeti (yeniden oynanırsa bir sonraki bitişte tekrar tetiklenir)
	$effect(() => {
		if (game?.phase === 'results' && !resultsCelebrated) {
			resultsCelebrated = true;
			sound.winner();
			fireWinnerConfetti(game.players[0]?.color);
		}
		if (game?.phase !== 'results') resultsCelebrated = false;
	});

	function handleJoin(e) {
		e.preventDefault();
		const name = nickname.trim();
		if (!name) return;
		sound.unlock();
		joining = true;
		gameStore.clearError();
		gameStore.joinRoom(code, name);
	}

	function handleSubmitPrompt(e) {
		e.preventDefault();
		const text = promptText.trim();
		if (!text) return;
		if (effectiveType === 'yalanci') {
			const answer = promptAnswer.trim();
			if (!answer) return;
			mySubmissions = [...mySubmissions, { type: 'yalanci', text, answer }];
			gameStore.submitPrompt('yalanci', text, answer);
			promptAnswer = '';
		} else {
			mySubmissions = [...mySubmissions, { type: 'kim_yapar', text }];
			gameStore.submitPrompt('kim_yapar', text);
		}
		promptText = '';
	}

	function handleSubmitFakeAnswer(e) {
		e.preventDefault();
		const text = fakeAnswerText.trim();
		if (!text) return;
		gameStore.submitFakeAnswer(text);
		fakeAnswerText = '';
	}

	function vote(targetId) {
		gameStore.castVote(targetId);
	}

	function copyLink() {
		if (!navigator.clipboard) return;
		navigator.clipboard.writeText(location.href).then(() => {
			linkCopied = true;
			setTimeout(() => (linkCopied = false), 1800);
		});
	}

	function confirmKick(p) {
		if (confirm(`${p.nickname} adlı oyuncuyu odadan atmak istediğine emin misin?`)) {
			gameStore.kickPlayer(p.id);
		}
	}

	let sharingCard = $state(false);
	async function handleShareCard() {
		if (!game || sharingCard) return;
		sharingCard = true;
		try {
			await shareOrDownloadResultCard({
				code,
				winnerName: game.players[0]?.nickname,
				winnerColor: game.players[0]?.color,
				awards: game.awards || [],
				players: game.players
			});
		} finally {
			sharingCard = false;
		}
	}
</script>

<svelte:head>
	<title>{code} — Panoya Pin</title>
</svelte:head>

<main class="screen wide">
	{#if !joined}
		<div class="stack">
			<span class="eyebrow">Odaya katıl</span>
			<h1 class="display code-hero">{code}</h1>
			<form onsubmit={handleJoin} class="stack">
				<input class="input" placeholder="Takma adın" aria-label="Takma adın" maxlength="20" bind:value={nickname} autocomplete="off" />
				{#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
				<button class="btn btn-primary big" type="submit" disabled={!nickname.trim() || joining}>Katıl</button>
			</form>
		</div>
	{:else if !game}
		<div class="loading-wrap">
			<LoadingDots />
			<p class="loading hand">bağlanıyor…</p>
		</div>
	{:else}
		<header class="topbar">
			<div class="brand hand">Panoya Pin</div>
			<div class="topbar-actions">
				<button
					class="sound-toggle"
					onclick={() => sound.toggle()}
					type="button"
					aria-label={sound.enabled ? 'Sesi kapat' : 'Sesi aç'}
					aria-pressed={sound.enabled}
					title={sound.enabled ? 'Sesi kapat' : 'Sesi aç'}
				>
					{sound.enabled ? '🔊' : '🔇'}
				</button>
				<button class="code-chip" onclick={copyLink} type="button" aria-label="Oda kodu {code}, davet linkini kopyala">
					<span class="code">{code}</span>
					<span class="copy-hint">{linkCopied ? 'Kopyalandı ✓' : 'Davet linkini kopyala'}</span>
				</button>
			</div>
		</header>

		<div class="me-bar">
			<span class="dot" style="background:{me?.color}" aria-hidden="true"></span>
			<span class="name">{me?.nickname}</span>
			{#if isOwner}<span class="owner-tag">★ kurucu</span>{/if}
			<span class="score"><AnimatedScore value={me?.score ?? 0} /> puan</span>
		</div>

		{#if game.phase === 'lobby'}
			<section class="stage centered">
				<div class="panel players-panel">
					<span class="eyebrow">Oyuncular ({game.players.length})</span>
					<ul class="roster">
						{#each game.players as p (p.id)}
							<li class="roster-row" class:offline={!p.connected}>
								<span class="dot" style="background:{p.color}" aria-hidden="true"></span>
								<span class="rname">{p.nickname}</span>
								{#if p.id === game.ownerId}<span class="owner-star" title="Oda kurucusu" aria-label="Oda kurucusu">★</span>{/if}
								{#if !p.connected}<span class="offline-tag">çevrimdışı</span>{/if}
								{#if isOwner && p.id !== store.playerId}
									<span class="roster-actions">
										<button
											class="mini-btn"
											type="button"
											title="Sahipliği devret"
											aria-label="{p.nickname} adlı oyuncuya sahipliği devret"
											disabled={!p.connected}
											onclick={() => gameStore.transferOwnership(p.id)}
										>★</button>
										<button
											class="mini-btn danger"
											type="button"
											title="Odadan at"
											aria-label="{p.nickname} adlı oyuncuyu odadan at"
											onclick={() => confirmKick(p)}
										>✕</button>
									</span>
								{/if}
							</li>
						{/each}
						{#if game.players.length === 0}
							<li class="chip-empty">Henüz kimse katılmadı</li>
						{/if}
					</ul>

					{#if isOwner}
						<span class="eyebrow mode-label" id="mode-label">Oyun modu</span>
						<div class="mode-options" role="group" aria-labelledby="mode-label">
							<button
								type="button"
								class="mode-card"
								class:active={selectedMode === 'kim_yapar'}
								aria-pressed={selectedMode === 'kim_yapar'}
								onclick={() => (selectedMode = 'kim_yapar')}
							>
								<span class="mode-emoji" aria-hidden="true">🎯</span>
								<span class="mode-name">Kim Yapar?</span>
								<span class="mode-desc">Grupta kim yapardı, oylayın</span>
							</button>
							<button
								type="button"
								class="mode-card"
								class:active={selectedMode === 'yalanci'}
								aria-pressed={selectedMode === 'yalanci'}
								onclick={() => (selectedMode = 'yalanci')}
							>
								<span class="mode-emoji" aria-hidden="true">🎭</span>
								<span class="mode-name">Yalancı Kim?</span>
								<span class="mode-desc">Sahte cevaplar arasından gerçeği bul</span>
							</button>
							<button
								type="button"
								class="mode-card"
								class:active={selectedMode === 'mixed'}
								aria-pressed={selectedMode === 'mixed'}
								onclick={() => (selectedMode = 'mixed')}
							>
								<span class="mode-emoji" aria-hidden="true">🎲</span>
								<span class="mode-name">Karışık</span>
								<span class="mode-desc">İkisi de karışık gelsin</span>
							</button>
						</div>

						<span class="eyebrow mode-label" id="rounds-label">Kaç tur?</span>
						<div class="round-options" role="group" aria-labelledby="rounds-label">
							{#each [5, 10, 15, null] as n (n ?? 'all')}
								<button
									type="button"
									class="round-chip"
									class:active={selectedRounds === n}
									aria-pressed={selectedRounds === n}
									onclick={() => (selectedRounds = n)}
								>{n ?? 'Tümü'}</button>
							{/each}
						</div>

						<button
							class="btn btn-primary big"
							disabled={game.players.length < MIN_PLAYERS_NOTE || !selectedMode}
							onclick={() => gameStore.startCollecting(selectedMode, selectedRounds)}
						>
							Beslemeyi Başlat
						</button>
						{#if game.players.length < MIN_PLAYERS_NOTE}
							<p class="hint">En az {MIN_PLAYERS_NOTE} oyuncu gerekiyor ({game.players.length}/{MIN_PLAYERS_NOTE})</p>
						{:else if !selectedMode}
							<p class="hint">Devam etmeden önce bir oyun modu seç.</p>
						{/if}
					{:else}
						<p class="hint">Oda kurucusu bir oyun modu seçip beslemeyi başlatacak.</p>
					{/if}
				</div>
				<p class="hint center">Arkadaşlarına davet linkini gönder, herkes kendi evinden katılabilir.</p>
			</section>
		{:else if game.phase === 'collecting'}
			<section class="stage centered">
				{#if game.selectedMode === 'mixed'}
					<div class="type-toggle" role="group" aria-label="İçerik türü">
						<button
							type="button"
							aria-pressed={promptType === 'kim_yapar'}
							class:active={promptType === 'kim_yapar'}
							onclick={() => (promptType = 'kim_yapar')}
						>Kim Yapar?</button>
						<button
							type="button"
							aria-pressed={promptType === 'yalanci'}
							class:active={promptType === 'yalanci'}
							onclick={() => (promptType = 'yalanci')}
						>Yalancı Kim?</button>
					</div>
				{/if}

				{#if effectiveType === 'kim_yapar'}
					<form class="stack" onsubmit={handleSubmitPrompt}>
						<div class="note note--tilt-a big-note">
							<p class="hand instr">Grubunuza dair bir senaryo yaz — bir anı, bir espri, ya da
								"kim yapar bunu?" tarzı bir soru.</p>
						</div>
						<textarea
							class="input textarea"
							placeholder="Örn: Toplantıya en son geç kalan kim olur?"
							aria-label="Senaryo"
							maxlength="140"
							bind:value={promptText}
						></textarea>
						<button class="btn btn-primary big" type="submit" disabled={!promptText.trim()}>Gönder</button>
					</form>
				{:else}
					<form class="stack" onsubmit={handleSubmitPrompt}>
						<div class="note note--tilt-a big-note">
							<p class="hand instr">Gerçek bir soru sor ve gerçek cevabını yaz — diğerleri buna
								inandırıcı sahte cevaplar uydurmaya çalışacak.</p>
						</div>
						<textarea
							class="input textarea"
							placeholder="Örn: Lisede benim lakabım neydi?"
							aria-label="Soru"
							maxlength="140"
							bind:value={promptText}
						></textarea>
						<input
							class="input"
							placeholder="Gerçek cevap"
							aria-label="Gerçek cevap"
							maxlength="80"
							bind:value={promptAnswer}
							autocomplete="off"
						/>
						<button class="btn btn-primary big" type="submit" disabled={!promptText.trim() || !promptAnswer.trim()}>Gönder</button>
					</form>
				{/if}

				{#if mySubmissions.length > 0}
					<div class="panel sent-list">
						<span class="eyebrow">Gönderdiklerin ({mySubmissions.length})</span>
						<ul>
							{#each mySubmissions as s}
								<li>{s.type === 'yalanci' ? '🎭 ' : '🎯 '}{s.text}</li>
							{/each}
						</ul>
					</div>
				{/if}

				<p class="counter"><strong>{game.submittedCount}</strong> içerik girildi (herkesten toplam)</p>

				{#if isOwner}
					<button class="btn btn-yellow big" onclick={() => gameStore.startGame()}>Oyunu Başlat</button>
					{#if game.submittedCount < 4}
						<p class="hint">Yetersiz içerik olursa otomatik olarak birkaç hazır soru/senaryo eklenir.</p>
					{/if}
				{:else}
					<p class="hint">Oda kurucusu hazır olduğunda oyunu başlatacak.</p>
				{/if}
			</section>
		{:else if game.phase === 'playing' && game.currentRound}
			<section class="stage centered">
				<div class="round-head" aria-live="polite">
					<p class="round-label eyebrow">Tur {game.roundNumber}{game.maxRounds ? ` / ${game.maxRounds}` : ''}</p>
					{#if secondsLeft !== null}
						<span class="timer-pill" class:urgent={secondsLeft <= 5}>⏱ {secondsLeft}s</span>
					{/if}
				</div>

				{#if game.currentRound.type === 'yalanci' && game.currentRound.askedBy}
					<p class="hint asked-by">🎤 {game.currentRound.askedBy} sordu</p>
				{/if}

				<div class="note note--tilt-b big-note prompt" aria-live="polite">
					<p>{game.currentRound.text}</p>
				</div>
				{#if game.currentRound.revealed}
					<p class="sr-only" aria-live="polite">Sonuçlar açıldı.</p>
				{/if}

				{#if game.currentRound.type === 'kim_yapar'}
					{#if !game.currentRound.revealed}
						<span class="eyebrow" id="vote-label">Kim yapar?</span>
						<ul class="vote-list" role="group" aria-labelledby="vote-label">
							{#each game.players as p (p.id)}
								<li>
									<button
										class="vote-btn"
										class:selected={store.myVote === p.id}
										aria-pressed={store.myVote === p.id}
										onclick={() => vote(p.id)}
									>
										<span class="dot" style="background:{p.color}" aria-hidden="true"></span>
										{p.nickname}
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<ul class="results">
							{#each sortedResults as r (r.id)}
								<li class:top={r.isTop}>
									<span class="dot" style="background:{r.color}" aria-hidden="true"></span>
									<span class="name">{r.nickname}</span>
									<span class="votes">{r.votes}</span>
									{#if r.isTop}<span class="pill iconic">ikonik</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{:else if game.currentRound.subPhase === 'writing' && !game.currentRound.revealed}
					{#if store.isExcluded}
						<p class="hint">Bu senin sorun — diğerleri sahte cevap yazarken bekle.</p>
					{:else if store.myFakeSubmitted}
						<p class="hint">Cevabın gönderildi, diğerlerini bekliyoruz…</p>
					{:else}
						<form class="stack" onsubmit={handleSubmitFakeAnswer}>
							<input
								class="input"
								placeholder="İnandırıcı bir sahte cevap yaz…"
								aria-label="Sahte cevabın"
								maxlength="80"
								bind:value={fakeAnswerText}
								autocomplete="off"
							/>
							<button class="btn btn-primary big" type="submit" disabled={!fakeAnswerText.trim()}>Gönder</button>
						</form>
					{/if}
				{:else if !game.currentRound.revealed}
					{#if store.isExcluded}
						<p class="hint">Sen soruyorsun — oy veremezsin, sonucu bekle.</p>
					{:else}
						<span class="eyebrow" id="lie-vote-label">Hangisi gerçek?</span>
						<ul class="vote-list" role="group" aria-labelledby="lie-vote-label">
							{#each game.currentRound.options as opt (opt.id)}
								<li>
									<button
										class="vote-btn"
										class:selected={store.myVote === opt.id}
										aria-pressed={store.myVote === opt.id}
										onclick={() => vote(opt.id)}
									>
										{opt.text}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<ul class="results">
						{#each game.currentRound.results as r (r.id)}
							<li class:top={r.isTrue}>
								<span class="name">{r.text}</span>
								<span class="votes">{r.votes}</span>
								<span class="pill" class:iconic={r.isTrue}>{r.isTrue ? 'GERÇEK' : r.nickname}</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if !game.currentRound.revealed}
					<p class="hint">{game.currentRound.respondedCount}/{game.currentRound.totalEligible}
						{game.currentRound.type === 'yalanci' && game.currentRound.subPhase === 'writing' ? 'cevap yazıldı' : 'oy verdi'}
						— süre bitince katılmayanlar boş geçmiş sayılır</p>
				{:else}
					{#if notRespondedCount > 0}
						<p class="hint">{notRespondedCount} kişi süresinde katılmadı, boş geçmiş sayıldı.</p>
					{/if}
					{#if isOwner}
						<button class="btn btn-primary big" onclick={() => gameStore.nextRound()}>
							{game.roundsRemaining > 0 ? 'Sıradaki Tur' : 'Sonuçları Gör'}
						</button>
					{:else}
						<p class="hint hand">kurucu sıradaki turu başlatacak…</p>
					{/if}
				{/if}

				<ol class="mini-score">
					{#each game.players as p (p.id)}
						<li>
							<span class="dot" style="background:{p.color}" aria-hidden="true"></span>
							<span class="name">{p.nickname}</span>
							<span class="score"><AnimatedScore value={p.score} /></span>
						</li>
					{/each}
				</ol>
			</section>
		{:else if game.phase === 'results'}
			<section class="stage centered">
				<p class="eyebrow">Oyun Bitti</p>
				{#if game.players[0]}
					<h2 class="display winner">
						<span class="hand">bu grubun efsanesi:</span><br />
						{game.players[0].nickname}
					</h2>
				{/if}

				{#if game.awards && game.awards.length > 0}
					<div class="awards-grid">
						{#each game.awards as a, i (a.key)}
							<div class="note note--tilt-{['a', 'b', 'c'][i % 3]} award-card">
								<span class="award-emoji">{a.emoji}</span>
								<span class="award-title">{a.title}</span>
								<span class="award-winner" style="color:{a.color}">{a.nickname}</span>
								<span class="award-desc">{a.description}</span>
							</div>
						{/each}
					</div>
				{/if}

				<ol class="scoreboard final panel">
					{#each game.players as p, i (p.id)}
						<li>
							<span class="rank">{i + 1}</span>
							<span class="dot" style="background:{p.color}" aria-hidden="true"></span>
							<span class="name">{p.nickname}</span>
							<span class="score"><AnimatedScore value={p.score} duration={900} /></span>
						</li>
					{/each}
				</ol>
				<div class="final-actions">
					{#if isOwner}
						<button class="btn btn-primary big" onclick={() => gameStore.playAgain()}>Yeniden Oyna</button>
					{/if}
					<button class="btn btn-yellow" disabled={sharingCard} onclick={handleShareCard}>
						{sharingCard ? 'Hazırlanıyor…' : '📤 Sonucu Paylaş'}
					</button>
					<button class="btn btn-secondary" onclick={() => { gameStore.leave(); goto('/'); }}>Ana Sayfa</button>
				</div>
			</section>
		{/if}

		{#if store.error}
			<p class="error toast">{store.error}</p>
		{/if}

		{#if store.notifications.length > 0}
			<div class="notif-stack">
				{#each store.notifications as n (n.id)}
					<p class="notif-pill" class:returned={n.kind === 'returned'}>
						{n.kind === 'returned' ? '🟢' : '🔴'} {n.text}
					</p>
				{/each}
			</div>
		{/if}
	{/if}
</main>

<style>
	.wide {
		max-width: 620px;
		width: 100%;
		margin: 0 auto;
	}
	.code-hero {
		font-size: 3rem;
		letter-spacing: 0.2em;
		text-align: center;
	}
	.loading-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		margin-top: 4rem;
	}
	.loading {
		font-size: 1.3rem;
		color: var(--ink);
		text-align: center;
	}

	.topbar {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.brand {
		font-size: 1.5rem;
		color: var(--ink);
		flex-shrink: 0;
	}
	.topbar-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.sound-toggle {
		appearance: none;
		border: 3px solid var(--ink);
		background: var(--paper);
		border-radius: 50%;
		width: 2.6rem;
		height: 2.6rem;
		flex-shrink: 0;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 3px 4px 0 var(--ink);
	}
	.sound-toggle:active {
		transform: translateY(2px);
		box-shadow: 1px 2px 0 var(--ink);
	}
	.code-chip {
		appearance: none;
		border: 3px solid var(--ink);
		background: var(--paper);
		border-radius: 999px;
		padding: 0.4rem 0.5rem 0.4rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--font-display);
		box-shadow: 3px 4px 0 var(--ink);
	}
	.code-chip:active {
		transform: translateY(2px);
		box-shadow: 1px 2px 0 var(--ink);
	}
	.code-chip .code {
		font-weight: 800;
		letter-spacing: 0.15em;
		font-size: 1.1rem;
	}
	.code-chip .copy-hint {
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--yellow);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.25rem 0.6rem;
	}

	.me-bar {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 999px;
		padding: 0.5rem 0.9rem;
		margin-bottom: 1.5rem;
		box-shadow: 3px 4px 0 var(--ink);
	}
	.me-bar .name {
		font-weight: 800;
		flex: 1;
	}
	.me-bar .score {
		font-weight: 800;
		color: var(--pink-deep);
	}
	.owner-tag {
		font-size: 0.75rem;
		font-weight: 800;
		background: var(--yellow);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--ink);
		flex-shrink: 0;
	}

	.stage {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.stage.centered {
		align-items: center;
		text-align: center;
	}

	.panel {
		width: 100%;
		background: var(--panel);
		border: 3px solid var(--ink);
		border-radius: 20px;
		padding: 1.25rem;
	}

	/* --- Lobi oyuncu listesi (owner devret/at kontrolleriyle) --- */
	.roster {
		list-style: none;
		padding: 0;
		margin: 1rem 0 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.roster-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 12px;
		padding: 0.5rem 0.7rem;
		font-weight: 700;
		text-align: left;
	}
	.roster-row.offline {
		opacity: 0.55;
	}
	.rname {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.owner-star {
		color: var(--yellow-deep);
	}
	.offline-tag {
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--panel);
		border: 1px solid var(--ink);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}
	.roster-actions {
		display: flex;
		gap: 0.35rem;
		flex-shrink: 0;
	}
	.mini-btn {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		border: 2px solid var(--ink);
		background: var(--yellow);
		font-weight: 800;
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.mini-btn:disabled {
		opacity: 0.4;
	}
	.mini-btn.danger {
		background: var(--red);
	}

	.chip-empty {
		color: var(--ink-soft);
		font-style: italic;
	}

	.mode-label {
		display: block;
		margin: 1.25rem 0 0.75rem;
	}
	.mode-options {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.6rem;
		margin-bottom: 1.25rem;
	}
	@media (min-width: 480px) {
		.mode-options {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.mode-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.3rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 16px;
		padding: 0.85rem 0.75rem;
		box-shadow: 3px 4px 0 var(--ink);
	}
	.mode-card:active {
		transform: translateY(2px);
		box-shadow: 1px 2px 0 var(--ink);
	}
	.mode-card.active {
		background: var(--yellow);
	}
	.mode-emoji {
		font-size: 1.5rem;
	}
	.mode-name {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 0.95rem;
	}
	.mode-desc {
		font-size: 0.75rem;
		color: var(--ink);
		opacity: 0.75;
		font-weight: 500;
		line-height: 1.3;
	}

	.round-options {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.round-chip {
		border: 3px solid var(--ink);
		background: var(--paper);
		border-radius: 999px;
		padding: 0.5rem 1.1rem;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 0.9rem;
		box-shadow: 2px 3px 0 var(--ink);
	}
	.round-chip:active {
		transform: translateY(2px);
		box-shadow: 1px 1px 0 var(--ink);
	}
	.round-chip.active {
		background: var(--yellow);
	}

	.type-toggle {
		display: flex;
		gap: 0.5rem;
		background: var(--panel);
		border: 3px solid var(--ink);
		border-radius: 999px;
		padding: 0.3rem;
	}
	.type-toggle button {
		border: none;
		background: transparent;
		color: var(--ink);
		font-weight: 700;
		font-size: 0.9rem;
		padding: 0.5rem 1rem;
		border-radius: 999px;
	}
	.type-toggle button.active {
		background: var(--paper);
		box-shadow: 2px 3px 0 var(--ink);
	}

	.asked-by {
		font-family: var(--font-hand);
		font-size: 1.1rem;
		margin-top: -0.5rem;
	}

	.big-note {
		max-width: 520px;
		font-size: 1.2rem;
		font-weight: 600;
		line-height: 1.4;
		width: 100%;
	}
	.instr {
		font-size: 1.3rem;
	}
	.counter {
		font-weight: 700;
	}
	.counter strong {
		font-size: 1.5rem;
		color: var(--pink-deep);
	}

	.textarea {
		resize: none;
		min-height: 5rem;
		font-family: var(--font-body);
	}

	.sent-list ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.sent-list li {
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 10px;
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.round-head {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}
	.timer-pill {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 0.85rem;
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
	}
	.timer-pill.urgent {
		background: var(--red);
		color: var(--paper);
	}

	.vote-list {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 100%;
		max-width: 420px;
	}
	.vote-btn {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 14px;
		padding: 0.9rem 1rem;
		color: var(--ink);
		font-family: var(--font-body);
		font-weight: 700;
		font-size: 1.05rem;
		box-shadow: 3px 4px 0 var(--ink);
	}
	.vote-btn:active {
		transform: translateY(2px);
		box-shadow: 1px 2px 0 var(--ink);
	}
	.vote-btn.selected {
		background: var(--yellow);
	}

	.results {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}
	.results li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.9rem;
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 12px;
	}
	.results li.top {
		background: var(--yellow);
	}
	.results .name {
		flex: 1;
		font-weight: 700;
		text-align: left;
	}
	.results .votes {
		font-weight: 800;
	}
	.results .pill.iconic {
		background: var(--yellow);
	}

	.mini-score {
		list-style: none;
		padding: 0.75rem 1rem;
		margin: 1.5rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		justify-content: center;
		background: rgba(255, 255, 255, 0.5);
		border: 2px dashed var(--ink);
		border-radius: 16px;
		width: 100%;
	}
	.mini-score li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.mini-score .score {
		color: var(--pink-deep);
	}

	.scoreboard {
		list-style: none;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.scoreboard.final li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1.1rem;
		font-weight: 700;
		padding: 0.5rem 0.25rem;
		border-bottom: 2px dashed var(--line);
	}
	.scoreboard .name {
		flex: 1;
		text-align: left;
	}
	.rank {
		width: 1.6rem;
		color: var(--ink-soft);
		font-weight: 800;
	}

	.winner {
		font-size: 2.4rem;
		margin: 0.25rem 0 1.25rem;
	}
	.winner .hand {
		display: block;
		font-size: 1.3rem;
		color: var(--ink);
		opacity: 0.75;
		font-family: var(--font-hand);
	}

	.awards-grid {
		width: 100%;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.1rem;
		margin: 0.5rem 0 2rem;
	}
	@media (min-width: 480px) {
		.awards-grid {
			grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		}
	}
	.award-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		text-align: center;
		padding: 1.1rem 0.9rem;
	}
	.award-emoji {
		font-size: 1.8rem;
	}
	.award-title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}
	.award-winner {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.3rem;
	}
	.award-desc {
		font-size: 0.8rem;
		font-weight: 500;
		line-height: 1.3;
		opacity: 0.85;
	}

	.final-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.5rem;
	}

	.hint {
		color: var(--ink);
		opacity: 0.75;
		font-weight: 600;
		font-size: 0.9rem;
		margin-top: 0.65rem;
	}
	.hint.center {
		text-align: center;
	}

	.error {
		color: var(--ink);
		background: var(--paper);
		border: 2px solid var(--red);
		border-radius: 10px;
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
		font-weight: 600;
		text-align: center;
	}
	.toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		translate: -50% 0;
		box-shadow: 3px 4px 0 var(--ink);
	}

	.notif-stack {
		position: fixed;
		top: 1rem;
		left: 50%;
		translate: -50% 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
		z-index: 40;
		pointer-events: none;
	}
	.notif-pill {
		margin: 0;
		background: var(--paper);
		color: var(--ink);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.4rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 700;
		box-shadow: 3px 4px 0 var(--ink);
		animation: notif-in 0.25s ease both;
	}
	.notif-pill.returned {
		background: var(--mint);
	}
	@keyframes notif-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
