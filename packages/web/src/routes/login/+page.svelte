<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Command, AlertCircle } from '@lucide/svelte';

	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let password = $state('');
	let name = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function handleLogin() {
		loading = true; error = null;
		try {
			const res = await fetch('/api/auth/sign-in/email', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			});
			if (res.ok) { window.location.href = '/'; }
			else { const data = await res.json().catch(() => ({})); error = data.message || 'Invalid email or password'; }
		} catch { error = 'Network error. Is the backend running?'; }
		loading = false;
	}

	async function handleRegister() {
		loading = true; error = null;
		try {
			const res = await fetch('/api/auth/sign-up/email', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, name: name || undefined }),
			});
			if (res.ok) { window.location.href = '/'; }
			else { const data = await res.json().catch(() => ({})); error = data.message || 'Registration failed'; }
		} catch { error = 'Network error. Is the backend running?'; }
		loading = false;
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (mode === 'login') handleLogin(); else handleRegister();
	}
</script>

<div class="min-h-screen flex items-center justify-center p-4">
	<Card.Root class="w-full max-w-sm">
		<Card.Header class="text-center">
			<div class="flex justify-center mb-2">
				<div class="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
					<Command class="size-5" />
				</div>
			</div>
			<Card.Title class="text-xl">MCP Platform</Card.Title>
			<Card.Description>{mode === 'login' ? 'Sign in to your account' : 'Create a new account'}</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if error}
				<Alert variant="destructive" class="mb-4">
					<AlertCircle class="size-4" />
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			{/if}

			<form onsubmit={handleSubmit} class="space-y-4">
				{#if mode === 'register'}
					<div class="space-y-2">
						<Label for="name">Name (optional)</Label>
						<Input id="name" type="text" bind:value={name} placeholder="Your name" />
					</div>
				{/if}

				<div class="space-y-2">
					<Label for="email">Email</Label>
					<Input id="email" type="email" bind:value={email} placeholder="you@example.com" required />
				</div>

				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input id="password" type="password" bind:value={password} placeholder="Enter password" required minlength={8} />
					{#if mode === 'register'}
						<p class="text-xs text-muted-foreground">Minimum 8 characters</p>
					{/if}
				</div>

				<Button type="submit" class="w-full" disabled={loading}>
					{#if loading}
						{mode === 'login' ? 'Signing in...' : 'Creating account...'}
					{:else}
						{mode === 'login' ? 'Sign In' : 'Create Account'}
					{/if}
				</Button>
			</form>
		</Card.Content>
		<Card.Footer class="justify-center">
			<Button variant="link" onclick={() => { mode = mode === 'login' ? 'register' : 'login'; error = null; }}>
				{mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
