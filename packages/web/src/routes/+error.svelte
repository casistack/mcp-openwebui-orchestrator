<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="min-h-[60vh] flex items-center justify-center">
	<div class="text-center">
		<p class="text-6xl font-bold text-[var(--color-text-muted)]">{page.status}</p>
		<h2 class="text-xl font-bold mt-4">
			{#if page.status === 404}
				Page not found
			{:else}
				Something went wrong
			{/if}
		</h2>
		<p class="text-sm text-[var(--color-text-muted)] mt-2 max-w-md">
			{#if page.error?.message}
				{page.error.message}
			{:else if page.status === 404}
				The page you're looking for doesn't exist or has been moved.
			{:else}
				An unexpected error occurred. Try refreshing the page.
			{/if}
		</p>
		<div class="mt-6 flex gap-3 justify-center">
			<a href="/" class="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm hover:opacity-90">
				Back to Dashboard
			</a>
			<button onclick={() => window.location.reload()} class="border border-[var(--color-border)] px-4 py-2 rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
				Refresh
			</button>
		</div>
	</div>
</div>
