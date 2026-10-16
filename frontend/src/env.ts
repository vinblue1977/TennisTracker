// Dev only (`npm run dev`, then /?mock): made-up data, no sign-in. False in production builds.
export const isMock = () => import.meta.env.DEV && new URLSearchParams(location.search).has('mock');
