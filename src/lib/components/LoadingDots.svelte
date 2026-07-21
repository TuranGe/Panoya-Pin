<span class="loading-dots" role="status" aria-label="yükleniyor">
	<span></span><span></span><span></span>
</span>

<style>
	.loading-dots {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
		justify-content: center;
	}
	.loading-dots span {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		border: 2px solid var(--ink);
		animation: dot-bounce 1s infinite ease-in-out both;
	}
	.loading-dots span:nth-child(1) {
		background: var(--pink);
		animation-delay: -0.32s;
	}
	.loading-dots span:nth-child(2) {
		background: var(--yellow);
		animation-delay: -0.16s;
	}
	.loading-dots span:nth-child(3) {
		background: var(--mint);
		animation-delay: 0s;
	}
	@keyframes dot-bounce {
		0%,
		80%,
		100% {
			transform: scale(0.6);
			opacity: 0.6;
		}
		40% {
			transform: scale(1);
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.loading-dots span {
			animation: none;
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
