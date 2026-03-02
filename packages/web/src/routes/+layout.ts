// Disable SSR for the entire app - this is an admin dashboard behind auth,
// no SEO needed, all data fetched client-side via tRPC
export const ssr = false;
