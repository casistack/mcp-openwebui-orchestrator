<script lang="ts">
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function handleLogin() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			});
			if (res.ok) {
				window.location.href = '/';
			} else {
				const data = await res.json();
				error = data.message || 'Login failed';
			}
		} catch {
			error = 'Network error';
		}
		loading = false;
	}
</script>

<div class="min-h-screen flex items-center justify-center">
	<div class="bg-[var(--color-surface)] rounded-lg p-8 border border-[var(--color-border)] w-full max-w-sm">
		<h2 class="text-xl font-bold mb-6 text-center">MCP Platform</h2>

		{#if error}
			<div class="bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded p-3 mb-4 text-sm text-[var(--color-error)]">
				{error}
			</div>
		{/if}

		<form onsubmit={handleLogin}>
			<label class="block mb-4">
				<span class="text-sm text-[var(--color-text-muted)]">Email</span>
				<input
					type="email"
					bind:value={email}
					class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none"
					required
				/>
			</label>
			<label class="block mb-6">
				<span class="text-sm text-[var(--color-text-muted)]">Password</span>
				<input
					type="password"
					bind:value={password}
					class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none"
					required
				/>
			</label>
			<button
				type="submit"
				disabled={loading}
				class="w-full bg-[var(--color-primary)] text-white py-2 rounded text-sm hover:opacity-90 disabled:opacity-50"
			>
				{loading ? 'Signing in...' : 'Sign In'}
			</button>
		</form>
	</div>
</div>
