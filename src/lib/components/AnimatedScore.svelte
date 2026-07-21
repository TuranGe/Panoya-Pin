<script>
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	let { value = 0, duration = 500 } = $props();

	// duration bir konfigürasyon değeri, reaktif olmasına gerek yok — düz bir değişkene alıp
	// Tween.of'un opsiyonlar objesine öyle veriyoruz (Svelte'in "yalnızca ilk değeri yakalar" uyarısını önler).
	const fixedDuration = duration;

	// Tween.of otomatik olarak `value` prop'unu izler, her değiştiğinde
	// tween.current'ı yumuşakça oraya taşır — puanın anlık zıplaması yerine sayarak artması için.
	const tween = Tween.of(() => value, { duration: fixedDuration, easing: cubicOut });
</script>

{Math.round(tween.current)}
