import { AccessToken, RoomServiceClient, TrackSource, TwirpError } from 'livekit-server-sdk'
import { env } from './env'

export type Participant = { identity: string; name: string }

export interface LiveKit {
  configured(): boolean
  url(): string
  issueToken(a: { room: string; identity: string; name: string; expiresAt: Date }): Promise<string>
  ensureRoom(room: string, maxParticipants: number): Promise<void>
  /** [] if the room does not exist. */
  participants(room: string): Promise<Participant[]>
  /** No-op if the room does not exist. */
  closeRoom(room: string): Promise<void>
  removeParticipant(room: string, identity: string): Promise<void>
}

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string }

/** Rooms are named in LiveKit by our room id, so a name can never collide with anything else on the same project. */
export const roomName = (roomId: string) => `room:${roomId}`

const EMPTY_TIMEOUT_SECONDS = 300

const notFound = (e: unknown) => e instanceof TwirpError && (e.status === 404 || e.code === 'not_found')

export function createLiveKit(cfg: LiveKitConfig): LiveKit {
  const configured = () => !!(cfg.url && cfg.apiKey && cfg.apiSecret)
  // The server API speaks http(s); the browser URL is ws(s).
  const client = () => new RoomServiceClient(cfg.url.replace(/^ws/, 'http'), cfg.apiKey, cfg.apiSecret)
  return {
    configured,
    url: () => cfg.url,
    async issueToken({ room, identity, name, expiresAt }) {
      // jose measures the ttl from the whole second it signs in, so count from the same second to land exactly on expiresAt.
      const ttl = Math.max(1, Math.floor(expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000))
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity, name, ttl })
      at.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true, canPublishSources: [TrackSource.MICROPHONE] })
      return at.toJwt()
    },
    async ensureRoom(room, maxParticipants) {
      await client().createRoom({ name: room, maxParticipants, emptyTimeout: EMPTY_TIMEOUT_SECONDS })
    },
    async participants(room) {
      try {
        const list = await client().listParticipants(room)
        return list.map((p) => ({ identity: p.identity, name: p.name }))
      } catch (e) {
        if (notFound(e)) return []
        throw e
      }
    },
    async closeRoom(room) {
      try {
        await client().deleteRoom(room)
      } catch (e) {
        if (!notFound(e)) throw e
      }
    },
    async removeParticipant(room, identity) {
      try {
        await client().removeParticipant(room, identity)
      } catch (e) {
        if (!notFound(e)) throw e
      }
    },
  }
}

export let livekit: LiveKit = createLiveKit(env.livekit)

/** Swaps the implementation (tests install a fake so nothing reaches the network). */
export function setLiveKit(impl: LiveKit) {
  livekit = impl
}
