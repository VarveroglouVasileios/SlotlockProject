import { createApp } from './app.js'
import { connect } from './db.js'

const sequelize = await connect()
const port = Number(process.env.PORT ?? 3000)
createApp(sequelize).listen(port, () => console.log(`slotlock listening on :${port} (${sequelize.getDialect()})`))
