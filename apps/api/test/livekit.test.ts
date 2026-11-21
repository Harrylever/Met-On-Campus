import { describe, expect, test } from 'bun:test'
import { TokenVerifier } from 'livekit-server-sdk'
import { createLiveKit, roomName } from '../src/livekit'

const full = { url: 'wss://example.livekit.test', apiKey: 'test-key', apiSecret: 'test-secret-that-is-long-enough-for-hs256' }

describe('livekit wrapper', () => {
  test('configured() is false when any of the three values is missing', () => {
    expect(createLiveKit(full).configured()).toBe(true)
    expect(createLiveKit({ ...full, url: '' }).configured()).toBe(false)
    expect(createLiveKit({ ...full, apiKey: '' }).configured()).toBe(false)
    expect(createLiveKit({ ...full, apiSecret: '' }).configured()).toBe(false)
  })

  test('issueToken signs a token that verifies with the secret, with identity, name, room, audio and data publish allowed, canPublish sources limited to microphone, and an expiry equal to expiresAt', async () => {
    const lk = createLiveKit(full)
    const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 3600_000)
    const jwt = await lk.issueToken({ room: roomName('abc'), identity: 'user-1', name: 'Ada', expiresAt })
    const claims = await new TokenVerifier(full.apiKey, full.apiSecret).verify(jwt)
    expect(claims.sub).toBe('user-1')
    expect(claims.name).toBe('Ada')
    expect(claims.exp).toBe(expiresAt.getTime() / 1000)
    expect(claims.video?.room).toBe('room:abc')
    expect(claims.video?.roomJoin).toBe(true)
    expect(claims.video?.canPublish).toBe(true)
    expect(claims.video?.canPublishData).toBe(true)
    expect(claims.video?.canSubscribe).toBe(true)
    expect(claims.video?.canPublishSources).toEqual(['microphone'])
  })

  test('roomName builds room:<id>', () => {
    expect(roomName('xyz')).toBe('room:xyz')
  })
})
