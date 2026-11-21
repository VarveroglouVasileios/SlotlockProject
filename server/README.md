# Slotlock server

Node.js + Express + TypeScript + Sequelize. PostgreSQL in production (`DATABASE_URL`), SQLite in tests and local runs.

```bash
cd server
yarn install
yarn test      # includes tests that send 25 simultaneous requests for the same slot
yarn dev       # http://localhost:3000, in-memory SQLite
```

## How double booking is prevented

Every confirmed booking writes one row per 30-minute slot into `slot_locks`, with `(roomId, slotStart)` as the **primary key**,
in the same transaction as the booking. A second booking of any overlapping slot violates the key, the whole transaction rolls back
and the API answers `409 slot_taken` with alternatives. The rule lives in the database, so it holds even if two server instances run
at once or the application code has a bug. (In SQLite the writes are additionally queued in process, only to avoid `SQLITE_BUSY`.)

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/rooms/:id/availability?date=YYYY-MM-DD` | free and busy slots, 08:00–20:00 UTC |
| POST | `/bookings` | body `{ roomId, start, end, name }`; optional `Idempotency-Key` header |
| GET | `/bookings/:ref` | |
| PATCH | `/bookings/:ref/cancel` | frees the slots; safe to repeat |

Times are UTC, aligned to 30 minutes, at most 8 hours, within one day.
