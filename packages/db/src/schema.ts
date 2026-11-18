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
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended'])
export const moderationActionEnum = pgEnum('moderation_action', ['dismiss', 'warn', 'suspend', 'unsuspend'])
export const departmentRequestStatusEnum = pgEnum('department_request_status', ['pending', 'approved', 'declined', 'withdrawn'])
// pending = waiting for staff; approved = shown to others; rejected = staff said no (the student sees the reason);
// replaced = a newer upload took its place; removed = the student or staff took it down.
export const photoStatusEnum = pgEnum('photo_status', ['pending', 'approved', 'rejected', 'replaced', 'removed'])
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
  status: userStatusEnum('status').notNull().default('active'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: text('suspended_reason'),
  // "Something is waiting" emails: on by default (a service notice, not marketing), one click to turn off. `lastAlert*`
  // keep it to one email per stretch of news; `unsubscribeToken` is the unguessable key in the email's unsubscribe link.
  emailAlerts: boolean('email_alerts').notNull().default(true),
  lastAlertAt: timestamp('last_alert_at', { withTimezone: true }),
  lastAlertSig: text('last_alert_sig'),
  unsubscribeToken: uuid('unsubscribe_token').notNull().unique().defaultRandom(),
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

// When each person last opened a conversation. Messages from the other person after this moment are "unread".
export const conversationReads = pgTable('conversation_reads', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })])

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
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }), // set when the host cancels; the row stays so members can be told
  createdAt: createdAt(),
}, (t) => [index('rooms_campus_idx').on(t.university, t.intent, t.startsAt), check('capacity_positive', sql`${t.capacity} > 0`)])

export const roomMembers = pgTable('room_members', {
  roomId: uuid('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: memberStatusEnum('status').notNull().default('pending'),
  // When the member last saw the outcome (approved, declined, cancelled). Null means there is news they have not seen.
  decisionSeenAt: timestamp('decision_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.roomId, t.userId] })])

// A block hides both people from each other everywhere (discover, rooms, chats, new connections).
export const blocks = pgTable('blocks', {
  blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId), check('no_self_block', sql`${t.blockerId} <> ${t.blockedId}`)])

// Reports are kept even if the message is later deleted, so reviewers still see what was reported, and even if either
// person later deletes their account (the link to the account is cleared; `reportedLabel` keeps just a name and campus).
export const reports = pgTable('reports', {
  id: id(),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  reportedId: uuid('reported_id').references(() => users.id, { onDelete: 'set null' }),
  reportedLabel: text('reported_label'), // set when the reported person deletes their account: "Name, campus"
  reason: reportReasonEnum('reason').notNull(),
  details: text('details').notNull().default(''),
  intent: intentEnum('intent'), // which mode it happened in, when known
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  messageSnapshot: text('message_snapshot'),
  status: reportStatusEnum('status').notNull().default('open'),
  reviewedBy: uuid('reviewed_by'), // admin_users.id (no FK so deleting an admin keeps the history)
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('reports_status_idx').on(t.status, t.createdAt), index('reports_reported_idx').on(t.reportedId)])

// ---- Admin-managed lists --------------------------------------------------------------------------
// Staff manage these from the platform. `university` null means "offered on every campus". Students store the
// chosen name as plain text (users.department, intent_profiles.usual_spot), so renaming here updates those rows too.
export const departments = pgTable('departments', {
  id: id(),
  name: text('name').notNull(),
  university: text('university'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('departments_name_campus').on(sql`lower(${t.name})`, sql`coalesce(${t.university}, '')`)])

export const campusSpots = pgTable('campus_spots', {
  id: id(),
  name: text('name').notNull(),
  university: text('university'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('campus_spots_name_campus').on(sql`lower(${t.name})`, sql`coalesce(${t.university}, '')`)])

// A student whose department is not listed asks for it. Staff approve it (as new, or by pointing at an existing one) or
// decline with a short reason. Requests for the same name on the same campus are resolved together.
export const departmentRequests = pgTable('department_requests', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  university: text('university').notNull(), // the requester's campus at the time
  name: text('name').notNull(),
  status: departmentRequestStatusEnum('status').notNull().default('pending'),
  resolvedName: text('resolved_name'), // the department it became, when approved
  note: text('note'), // staff's reason, shown to the student when declined
  reviewedBy: uuid('reviewed_by'), // admin_users.id (no FK so deleting an admin keeps the history)
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('department_requests_one_pending').on(t.userId).where(sql`${t.status} = 'pending'`), // one open request per student
  index('department_requests_campus_idx').on(t.university, t.status),
])

// One photo per student per mode, never shared across modes. A photo is private until staff approve it; a student can
// have an approved photo showing while a replacement waits for review. The image itself lives in object storage
// (`storageKey`); the file is deleted when the row stops being pending/approved.
export const profilePhotos = pgTable('profile_photos', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  intent: intentEnum('intent').notNull(),
  storageKey: text('storage_key').notNull(),
  status: photoStatusEnum('status').notNull().default('pending'),
  note: text('note'), // staff's reason, shown to the student when rejected
  reviewedBy: uuid('reviewed_by'), // admin_users.id (no FK so deleting an admin keeps the history)
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('profile_photos_one_pending').on(t.userId, t.intent).where(sql`${t.status} = 'pending'`),
  uniqueIndex('profile_photos_one_approved').on(t.userId, t.intent).where(sql`${t.status} = 'approved'`),
  index('profile_photos_queue_idx').on(t.status, t.createdAt),
])

// ---- Platform (staff) ----------------------------------------------------------------------------
// Staff are separate from students: own table, own sessions, own audit trail. Created only by the
// `admin:invite` CLI; there is no public sign-up. Secrets are never stored in plain text:
// password = argon2id, TOTP secret = AES-256-GCM, backup codes + setup token + session tokens = SHA-256.
export const adminUsers = pgTable('admin_users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  backupCodeHashes: text('backup_code_hashes').array().notNull().default(sql`'{}'::text[]`),
  setupTokenHash: text('setup_token_hash'),
  setupExpiresAt: timestamp('setup_expires_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const adminSessions = pgTable('admin_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  adminId: uuid('admin_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('admin_sessions_admin_idx').on(t.adminId)])

// Append-only record of what staff did: logins, searches, views of a student, every moderation step.
export const adminAudit = pgTable('admin_audit', {
  id: id(),
  adminId: uuid('admin_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  meta: text('meta'), // small JSON string; never contains secrets
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('admin_audit_created_idx').on(t.createdAt), index('admin_audit_admin_idx').on(t.adminId, t.createdAt)])

export const moderationActions = pgTable('moderation_actions', {
  id: id(),
  adminId: uuid('admin_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), // cleared if the account is deleted; the record of the action stays
  reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
  action: moderationActionEnum('action').notNull(),
  note: text('note').notNull().default(''),
  createdAt: createdAt(),
}, (t) => [index('moderation_user_idx').on(t.userId, t.createdAt)])

export const userRelations = relations(users, ({ many }) => ({ profiles: many(intentProfiles) }))
export const profileRelations = relations(intentProfiles, ({ one }) => ({ user: one(users, { fields: [intentProfiles.userId], references: [users.id] }) }))
export const roomRelations = relations(rooms, ({ one, many }) => ({ host: one(users, { fields: [rooms.hostId], references: [users.id] }), members: many(roomMembers) }))
export const memberRelations = relations(roomMembers, ({ one }) => ({ room: one(rooms, { fields: [roomMembers.roomId], references: [rooms.id] }), user: one(users, { fields: [roomMembers.userId], references: [users.id] }) }))
export const messageRelations = relations(messages, ({ one }) => ({ conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }) }))
