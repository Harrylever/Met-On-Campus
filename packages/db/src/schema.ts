import { relations, sql } from 'drizzle-orm'
import {
  boolean, check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

export const intentEnum = pgEnum('intent', ['study', 'friends', 'romance'])
export const roomIntentEnum = pgEnum('room_intent', ['study', 'friends'])
export const requestStatusEnum = pgEnum('request_status', ['pending', 'accepted', 'declined'])
export const messageKindEnum = pgEnum('message_kind', ['text', 'meetup'])
export const meetupStatusEnum = pgEnum('meetup_status', ['pending', 'confirmed', 'declined'])
export const reportReasonEnum = pgEnum('report_reason', ['harassment', 'spam', 'fake_profile', 'inappropriate', 'unsafe', 'other'])
export const reportStatusEnum = pgEnum('report_status', ['open', 'reviewed', 'dismissed'])
export const memberStatusEnum = pgEnum('member_status', ['pending', 'approved', 'declined'])

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(), // never exposed to other users
  university: text('university').notNull(), // e.g. "FUTMinna", derived from email domain
  name: text('name').notNull(),
  department: text('department').notNull(),
  level: integer('level').notNull(), // 100..500
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [check('level_range', sql`${t.level} between 100 and 900`)])

export const emailCodes = pgTable('email_codes', {
  email: text('email').primaryKey(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

// One row per (user, intent): a separate profile per mode, never mixed.
export const intentProfiles = pgTable('intent_profiles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  intent: intentEnum('intent').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  prompt: text('prompt').notNull().default(''),
  bio: text('bio').notNull().default(''),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  usuallyFree: text('usually_free').notNull().default(''),
  usualSpot: text('usual_spot').notNull().default(''),
  hideFromDepartment: boolean('hide_from_department').notNull().default(false), // romance only
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.intent] }), index('profiles_intent_idx').on(t.intent, t.enabled)])

// Invite / Say Hi / Spark. Becomes a conversation once accepted (or sent as first message).
export const connectionRequests = pgTable('connection_requests', {
  id: id(),
  intent: intentEnum('intent').notNull(),
  fromUserId: uuid('from_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toUserId: uuid('to_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: requestStatusEnum('status').notNull().default('pending'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('request_unique').on(t.intent, t.fromUserId, t.toUserId)])

// Conversations are segmented by intent. userA < userB (uuid order) keeps the pair unique.
export const conversations = pgTable('conversations', {
  id: id(),
  intent: intentEnum('intent').notNull(),
  userAId: uuid('user_a_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userBId: uuid('user_b_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('conversation_pair').on(t.intent, t.userAId, t.userBId),
  check('ordered_pair', sql`${t.userAId} < ${t.userBId}`),
])

export const messages = pgTable('messages', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: messageKindEnum('kind').notNull().default('text'),
  body: text('body'),
  meetupWhere: text('meetup_where'),
  meetupWhen: timestamp('meetup_when', { withTimezone: true }),
  meetupStatus: meetupStatusEnum('meetup_status'),
  createdAt: createdAt(),
}, (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt)])

// Public campus spots only; rooms exist for study and friends, never romance.
export const rooms = pgTable('rooms', {
  id: id(),
  intent: roomIntentEnum('intent').notNull(),
  hostId: uuid('host_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  university: text('university').notNull(),
  tag: text('tag').notNull(),
  title: text('title').notNull(),
  place: text('place').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull(),
  createdAt: createdAt(),
}, (t) => [index('rooms_campus_idx').on(t.university, t.intent, t.startsAt), check('capacity_positive', sql`${t.capacity} > 0`)])

export const roomMembers = pgTable('room_members', {
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: memberStatusEnum('status').notNull().default('pending'),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.roomId, t.userId] })])

// A block hides both people from each other everywhere (discover, rooms, chats, new connections).
export const blocks = pgTable('blocks', {
  blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId), check('no_self_block', sql`${t.blockerId} <> ${t.blockedId}`)])

// Reports are kept even if the message is later deleted, so reviewers still see what was reported.
export const reports = pgTable('reports', {
  id: id(),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reportedId: uuid('reported_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: reportReasonEnum('reason').notNull(),
  details: text('details').notNull().default(''),
  intent: intentEnum('intent'), // which mode it happened in, when known
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  messageSnapshot: text('message_snapshot'),
  status: reportStatusEnum('status').notNull().default('open'),
  createdAt: createdAt(),
}, (t) => [index('reports_status_idx').on(t.status, t.createdAt), index('reports_reported_idx').on(t.reportedId)])

export const userRelations = relations(users, ({ many }) => ({ profiles: many(intentProfiles) }))
export const profileRelations = relations(intentProfiles, ({ one }) => ({ user: one(users, { fields: [intentProfiles.userId], references: [users.id] }) }))
export const roomRelations = relations(rooms, ({ one, many }) => ({ host: one(users, { fields: [rooms.hostId], references: [users.id] }), members: many(roomMembers) }))
export const memberRelations = relations(roomMembers, ({ one }) => ({ room: one(rooms, { fields: [roomMembers.roomId], references: [rooms.id] }), user: one(users, { fields: [roomMembers.userId], references: [users.id] }) }))
export const messageRelations = relations(messages, ({ one }) => ({ conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }) }))
