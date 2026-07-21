<script>
	import { gameStore } from '$lib/client/socket.svelte.js';
	import { sound } from '$lib/client/sound.svelte.js';
	import { goto } from '$app/navigation';

	const store = gameStore.state;

	let mode = $state('landing'); // 'landing' | 'create' | 'join'
	let code = $state('');
	let nickname = $state(store.nickname || '');
	let busy = $state(false);

	function handleCreate(e) {
		e.preventDefault();
		const name = nickname.trim();
		if (!name) return;
		sound.unlock();
		busy = true;
		gameStore.createRoom(name, (roomCode) => goto(`/play/${roomCode}`));
	}

	function handleJoin(e) {
		e.preventDefault();
		const cleanCode = code.trim().toUpperCase();
		const name = nickname.trim();
		if (cleanCode.length !== 4 || !name) return;
		sound.unlock();
		busy = true;
		gameStore.clearError();
		gameStore.joinRoom(cleanCode, name, (roomCode) => goto(`/play/${roomCode}`));
	}

	$effect(() => {
		if (busy && store.error) busy = false;
	});
</script>

<svelte:head>
	<title>Panoya Pin — Grubunun kendi oyunu</title>
</svelte:head>

<main class="screen">
	<div class="hero">
		<span class="eyebrow badge">✦ Açık kaynak · herkes kendi evinden oynar ✦</span>
		<h1 class="display title">
			Kelimeler <span class="hand tilt">sizin.</span><br />Oyun <span class="hand tilt-r">bizim.</span>
		</h1>
		<p class="lede">
			Panoya Pin, kendi anılarınızı ve içinizdeki espriyi oyunun malzemesi yapan bir parti oyunu.
			Bir tane bile aynı şekilde oynanmaz — çünkü içeriği siz yazıyorsınız. Kod paylaş, herkes
			kendi telefonundan ya da bilgisayarından katılsın.
		</p>
	</div>

	<div class="board" aria-hidden="true">
		<div class="note note--tilt-a mini">"Toplantıya en son geç kalan…"</div>
		<div class="note note--tilt-b mini">"Gece yarısı arayacak kişi…"</div>
		<div class="note note--tilt-c mini">"Valizini son ana bırakan…"</div>
	</div>

	{#if mode === 'landing'}
		<div class="stack actions">
			<button class="btn btn-primary big" onclick={() => (mode = 'create')}>Oda Kur</button>
			<button class="btn btn-yellow big" onclick={() => (mode = 'join')}>Odaya Katıl</button>
			<p class="hint">Uzaktan oynanır — herkes farklı bir yerden bağlanabilir, aynı odada olmanıza gerek yok.</p>
		</div>
	{:else if mode === 'create'}
		<form class="stack actions" onsubmit={handleCreate}>
			<input class="input" placeholder="Takma adın" maxlength="20" bind:value={nickname} autocomplete="off" />
			{#if store.error}<p class="error">{store.error}</p>{/if}
			<button class="btn btn-primary big" type="submit" disabled={!nickname.trim() || busy}>
				{busy ? 'Oda kuruluyor…' : 'Oda Kur'}
			</button>
			<button class="btn btn-secondary" type="button" onclick={() => (mode = 'landing')}>Geri</button>
		</form>
	{:else}
		<form class="stack actions" onsubmit={handleJoin}>
			<input
				class="input code-input"
				placeholder="ODA KODU"
				maxlength="4"
				bind:value={code}
				oninput={() => (code = code.toUpperCase())}
				autocomplete="off"
				autocapitalize="characters"
			/>
			<input class="input" placeholder="Takma adın" maxlength="20" bind:value={nickname} autocomplete="off" />
			{#if store.error}<p class="error">{store.error}</p>{/if}
			<button class="btn btn-yellow big" type="submit" disabled={code.trim().length !== 4 || !nickname.trim() || busy}>
				{busy ? 'Katılıyor…' : 'Katıl'}
			</button>
			<button class="btn btn-secondary" type="button" onclick={() => (mode = 'landing')}>Geri</button>
		</form>
	{/if}

	<section class="how-to-score">
		<h2 class="display section-title">Nasıl puan kazanılır?</h2>

		<div class="mode-group">
			<span class="mode-label">🎯 Kim Yapar?</span>
			<div class="score-cards">
				<div class="note note--tilt-a score-card">
					<span class="score-badge">+10</span>
					<p><strong>Çoğunluğu tahmin et.</strong> Her turda grubun kimin için en uygun olduğunu
						oylarsınız. Sen de grubun çoğunluğuyla aynı kişiyi seçtiysen puanı cebe atarsın.</p>
				</div>
				<div class="note note--tilt-b score-card">
					<span class="score-badge">+5</span>
					<p><strong>İkonik ol.</strong> O turda en çok oyu <em>sen</em> alırsan — yani grup seni
						o işe en uygun gördüyse — kim oyladıysa fark etmeksizin bonus kazanırsın.</p>
				</div>
			</div>
		</div>

		<div class="mode-group">
			<span class="mode-label">🎭 Yalancı Kim?</span>
			<div class="score-cards">
				<div class="note note--tilt-c score-card">
					<span class="score-badge">+10</span>
					<p><strong>Gerçeği bul.</strong> Diğerlerinin uydurduğu sahte cevaplar arasından gerçek
						cevabı doğru tahmin edersen puanı cebe atarsın.</p>
				</div>
				<div class="note note--tilt-a score-card">
					<span class="score-badge">+5</span>
					<p><strong>Kandır.</strong> Yazdığın sahte cevaba kim inanıp oy verirse, kandırdığın her
						kişi için ayrıca puan kazanırsın.</p>
				</div>
				<div class="note note--tilt-b score-card">
					<span class="score-badge">+5</span>
					<p><strong>İyi soru sor.</strong> Soruyu sen sorduysan sabit bir bonus alırsın — ama o
						turda cevap yazamaz, oy veremezsin (zaten cevabı biliyorsun).</p>
				</div>
			</div>
		</div>

		<p class="hint center">Her turun 25 saniyesi var — süre dolunca katılmayanlar boş geçmiş sayılır, kimseyi beklemeye gerek yok.</p>
	</section>
</main>

<style>
	.hero {
		max-width: 600px;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		margin-top: 1.5rem;
	}

	.badge {
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 999px;
		padding: 0.4rem 1rem;
		display: inline-block;
		align-self: center;
		box-shadow: 3px 4px 0 var(--ink);
	}

	.title {
		font-size: clamp(2.4rem, 8vw, 4rem);
		line-height: 1.05;
		color: var(--ink);
		text-shadow: 3px 3px 0 rgba(255, 255, 255, 0.35);
	}

	.hand {
		font-size: 1.1em;
		color: var(--paper);
		-webkit-text-stroke: 2px var(--ink);
	}
	.tilt {
		display: inline-block;
		transform: rotate(-3deg);
	}
	.tilt-r {
		display: inline-block;
		transform: rotate(2deg);
	}

	.lede {
		color: var(--ink);
		opacity: 0.85;
		font-size: 1.08rem;
		font-weight: 600;
		line-height: 1.55;
		max-width: 460px;
		margin: 0 auto;
	}

	.board {
		width: 100%;
		max-width: 560px;
		margin: 2.25rem 0 1.5rem;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem 1.25rem;
	}
	.mini {
		font-family: var(--font-hand);
		font-size: 1.1rem;
		font-weight: 700;
		padding: 0.6rem 1.1rem;
		max-width: 210px;
		line-height: 1.25;
	}

	.actions {
		margin-top: 1rem;
	}

	.big {
		width: 100%;
		padding: 1.1rem 1.5rem;
		font-size: 1.15rem;
	}

	.hint {
		text-align: center;
		color: var(--ink);
		opacity: 0.75;
		font-weight: 600;
		font-size: 0.9rem;
		margin-top: 0.25rem;
	}

	.code-input {
		text-align: center;
		letter-spacing: 0.35em;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.5rem;
		text-transform: uppercase;
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

	.how-to-score {
		width: 100%;
		max-width: 720px;
		margin-top: 3.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}
	.section-title {
		font-size: clamp(1.6rem, 5vw, 2.2rem);
		text-align: center;
		color: var(--ink);
	}
	.mode-group {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	.mode-label {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.05rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 999px;
		padding: 0.35rem 1.1rem;
		box-shadow: 3px 4px 0 var(--ink);
	}
	.score-cards {
		width: 100%;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
	}
	@media (min-width: 640px) {
		.score-cards {
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		}
	}
	.score-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
		text-align: left;
		font-size: 1rem;
		line-height: 1.5;
	}
	.score-card p {
		font-weight: 500;
	}
	.score-card strong {
		font-family: var(--font-display);
	}
	.score-badge {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.6rem;
		background: var(--mint);
		border: 3px solid var(--ink);
		border-radius: 999px;
		padding: 0.15rem 1rem;
		box-shadow: 3px 4px 0 var(--ink);
	}
</style>
