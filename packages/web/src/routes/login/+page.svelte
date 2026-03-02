<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Separator } from '$lib/components/ui/separator';
	import { Command, AlertCircle, Github } from '@lucide/svelte';

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

			<div class="relative my-4">
				<Separator />
				<span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
					or continue with
				</span>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<Button
					variant="outline"
					class="w-full"
					onclick={() => { window.location.href = '/api/auth/sign-in/social?provider=google&callbackURL=/'; }}
				>
					<svg class="size-4 mr-2" viewBox="0 0 24 24" fill="none">
						<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
						<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
						<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
						<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
					</svg>
					Google
				</Button>
				<Button
					variant="outline"
					class="w-full"
					onclick={() => { window.location.href = '/api/auth/sign-in/social?provider=github&callbackURL=/'; }}
				>
					<Github class="size-4 mr-2" />
					GitHub
				</Button>
			</div>
		</Card.Content>
		<Card.Footer class="justify-center">
			<Button variant="link" onclick={() => { mode = mode === 'login' ? 'register' : 'login'; error = null; }}>
				{mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
