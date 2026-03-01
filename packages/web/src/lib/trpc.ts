import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../node_modules/@mcp-platform/backend/dist/trpc/routers.js';

export const trpc = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: '/api/trpc',
		}),
	],
});
