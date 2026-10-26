# Spendcast client

React 18 + TypeScript + Vite front end for the expense forecast API in `../server`.

## Develop

1. Start the API: `cd ../server && npm start` (port from `server/.env`, default 5000).
2. Start the client: `npm install` once, then `npm run dev`, and open http://localhost:5173.

The dev server forwards `/api` to the API. If the API runs on another port, copy
`.env.example` to `.env` and set `VITE_API_TARGET`.

## Production

`npm run build` type-checks and writes `dist/`. The Express server serves `dist/`
automatically (same origin, so no CORS), including deep links like `/expenses`.
Restart the server after building.

## Structure

- `src/lib`: API client, auth session, theme, toasts, React Query hooks, formatting
- `src/components`: app shell, forecast chart, dialogs, UI primitives
- `src/pages`: Dashboard, Expenses, Recurring, Settings, Login, Sign up
- `src/styles/global.css`: design tokens (light/dark) and component styles

## Notes

- The session token is kept in `localStorage`. For higher security, move to an
  httpOnly cookie set by the server.
