<script>
	import { untrack } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	let { value = 0, duration = 500 } = $props();

	// duration bir konfigürasyon değeri — Tween.of'un opsiyonlar objesi tek seferlik kurulduğu
	// için burada reaktif olmasına gerek yok. untrack() ile bunun kasıtlı bir "anlık görüntü"
	// olduğunu derleyiciye bildiriyoruz (Svelte'in "yalnızca ilk değeri yakalar" uyarısını önler).
	const fixedDuration = untrack(() => duration);

	// Tween.of otomatik olarak `value` prop'unu izler, her değiştiğinde
	// tween.current'ı yumuşakça oraya taşır — puanın anlık zıplaması yerine sayarak artması için.
	const tween = Tween.of(() => value, { duration: fixedDuration, easing: cubicOut });
</script>

{Math.round(tween.current)}
