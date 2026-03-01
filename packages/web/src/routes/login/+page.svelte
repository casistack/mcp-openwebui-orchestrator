<script lang="ts">
	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let password = $state('');
	let name = $state('');
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
				const data = await res.json().catch(() => ({}));
				error = data.message || 'Invalid email or password';
			}
		} catch {
			error = 'Network error. Is the backend running?';
		}
		loading = false;
	}

	async function handleRegister() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, name: name || undefined }),
			});
			if (res.ok) {
				window.location.href = '/';
			} else {
				const data = await res.json().catch(() => ({}));
				error = data.message || 'Registration failed';
			}
		} catch {
			error = 'Network error. Is the backend running?';
		}
		loading = false;
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (mode === 'login') handleLogin();
		else handleRegister();
	}

	function switchMode() {
		mode = mode === 'login' ? 'register' : 'login';
		error = null;
	}
</script>

<div class="min-h-screen flex items-center justify-center p-4">
	<div class="bg-[var(--color-surface)] rounded-lg p-8 border border-[var(--color-border)] w-full max-w-sm">
		<div class="text-center mb-6">
			<h2 class="text-xl font-bold">MCP Platform</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">
				{mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
			</p>
		</div>

		{#if error}
			<div class="rounded-lg p-3 mb-4 text-sm border" style="background: color-mix(in srgb, var(--color-error) 10%, transparent); border-color: var(--color-error); color: var(--color-error);">
				{error}
			</div>
		{/if}

		<form onsubmit={handleSubmit}>
			{#if mode === 'register'}
				<label class="block mb-4">
					<span class="text-sm text-[var(--color-text-muted)]">Name (optional)</span>
					<input
						type="text"
						bind:value={name}
						placeholder="Your name"
						class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none"
					/>
				</label>
			{/if}

			<label class="block mb-4">
				<span class="text-sm text-[var(--color-text-muted)]">Email</span>
				<input
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none"
					required
				/>
			</label>

			<label class="block mb-6">
				<span class="text-sm text-[var(--color-text-muted)]">Password</span>
				<input
					type="password"
					bind:value={password}
					placeholder="Enter password"
					class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none"
					required
					minlength={8}
				/>
				{#if mode === 'register'}
					<p class="text-[10px] text-[var(--color-text-muted)] mt-1">Minimum 8 characters</p>
				{/if}
			</label>

			<button
				type="submit"
				disabled={loading}
				class="w-full bg-[var(--color-primary)] text-white py-2.5 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
			>
				{#if loading}
					{mode === 'login' ? 'Signing in...' : 'Creating account...'}
				{:else}
					{mode === 'login' ? 'Sign In' : 'Create Account'}
				{/if}
			</button>
		</form>

		<div class="mt-4 text-center">
			<button onclick={switchMode} class="text-sm text-[var(--color-primary)] hover:underline">
				{mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
			</button>
		</div>
	</div>
</div>
