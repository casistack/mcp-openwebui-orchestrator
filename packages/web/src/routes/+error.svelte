<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { AlertTriangle } from '@lucide/svelte';
</script>

<div class="min-h-[60vh] flex items-center justify-center">
	<Card.Root class="w-full max-w-md text-center">
		<Card.Header>
			<div class="flex justify-center mb-2">
				<AlertTriangle class="size-12 text-muted-foreground" />
			</div>
			<p class="text-5xl font-bold text-muted-foreground">{page.status}</p>
			<Card.Title class="text-xl mt-2">
				{#if page.status === 404}Page not found{:else}Something went wrong{/if}
			</Card.Title>
			<Card.Description>
				{#if page.error?.message}
					{page.error.message}
				{:else if page.status === 404}
					The page you're looking for doesn't exist or has been moved.
				{:else}
					An unexpected error occurred. Try refreshing the page.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Footer class="justify-center gap-3">
			<Button href="/">Back to Dashboard</Button>
			<Button variant="outline" onclick={() => window.location.reload()}>Refresh</Button>
		</Card.Footer>
	</Card.Root>
</div>
