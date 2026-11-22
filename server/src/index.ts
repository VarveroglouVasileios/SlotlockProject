import { createApp } from './app.js'
import { cleanup, connect } from './db.js'

const sequelize = await connect()
const port = Number(process.env.PORT ?? 3000)
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const run = async (): Promise<void> => {
  try {
    const n = await cleanup(sequelize)
    if (n) console.log(`cleanup: removed ${n} past bookings`)
  } catch (err) {
    console.error('cleanup failed', err)
  }
}
await run()
setInterval(run, 3_600_000).unref()

createApp(sequelize, { allowedOrigins }).listen(port, () => console.log(`slotlock listening on :${port} (${sequelize.getDialect()}), CORS for ${allowedOrigins.join(', ') || 'no origins'}`))
