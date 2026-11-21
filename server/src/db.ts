import { DataTypes, Model, Sequelize, type InferAttributes, type InferCreationAttributes } from 'sequelize'

export class Room extends Model<InferAttributes<Room>, InferCreationAttributes<Room>> {
  declare id: string
  declare name: string
}
export class Booking extends Model<InferAttributes<Booking>, InferCreationAttributes<Booking>> {
  declare ref: string
  declare roomId: string
  declare start: string
  declare end: string
  declare name: string
  declare status: 'confirmed' | 'cancelled'
  declare idempotencyKey: string | null
  declare fingerprint: string | null
}
/**
 * One row per room and 30-minute slot of every confirmed booking.
 * The composite primary key is the lock: the database itself refuses a second booking of the same slot.
 */
export class SlotLock extends Model<InferAttributes<SlotLock>, InferCreationAttributes<SlotLock>> {
  declare roomId: string
  declare slotStart: string
  declare bookingRef: string
}

export function initModels(sequelize: Sequelize): void {
  Room.init({ id: { type: DataTypes.STRING, primaryKey: true }, name: { type: DataTypes.STRING, allowNull: false } }, { sequelize, tableName: 'rooms', timestamps: false })
  Booking.init(
    {
      ref: { type: DataTypes.STRING, primaryKey: true },
      roomId: { type: DataTypes.STRING, allowNull: false },
      start: { type: DataTypes.STRING, allowNull: false },
      end: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'confirmed' },
      idempotencyKey: { type: DataTypes.STRING, allowNull: true, unique: true },
      fingerprint: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, tableName: 'bookings', timestamps: true },
  )
  SlotLock.init(
    { roomId: { type: DataTypes.STRING, primaryKey: true }, slotStart: { type: DataTypes.STRING, primaryKey: true }, bookingRef: { type: DataTypes.STRING, allowNull: false } },
    { sequelize, tableName: 'slot_locks', timestamps: false },
  )
}

export async function connect(url = process.env.DATABASE_URL, storage?: string): Promise<Sequelize> {
  const sequelize = url?.startsWith('postgres')
    ? new Sequelize(url, { logging: false, dialectOptions: process.env.PGSSL === 'off' ? {} : { ssl: { require: true, rejectUnauthorized: false } } })
    : new Sequelize({ dialect: 'sqlite', storage: storage ?? ':memory:', logging: false })
  initModels(sequelize)
  await sequelize.sync()
  if (sequelize.getDialect() === 'sqlite') await sequelize.query('PRAGMA busy_timeout = 5000')
  await Room.bulkCreate([{ id: 'room-3', name: 'Δωμάτιο 3' }, { id: 'room-4', name: 'Δωμάτιο 4' }, { id: 'room-5', name: 'Δωμάτιο 5' }], { ignoreDuplicates: true })
  return sequelize
}
