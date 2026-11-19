import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { formatHttpLine, setHttpLogSink } from '../src/httplog'
import { call, makeUser, resetAll } from './helpers'

let lines: string[]
beforeEach(async () => { await resetAll(); lines = []; setHttpLogSink((l) => lines.push(l)) })
afterAll(() => setHttpLogSink(null))
const settle = () => new Promise((r) => setTimeout(r, 30)) // the line is written after the response is sent

describe('http log', () => {
  test('a line is method, route, status and milliseconds', () => {
    expect(formatHttpLine('POST', '/admin/broadcasts', 200, 12.4)).toBe('[http] POST /admin/broadcasts 200 12ms')
  })

  test('logs the route that ran, with its status', async () => {
    const u = await makeUser('Amina')
    await call(u, 'POST', '/me/push/test'); await settle()
    expect(lines.some((l) => /^\[http\] POST \/me\/push\/test \d{3} \d+ms$/.test(l))).toBe(true)
  })

  test('never logs the real path parameters or the query string', async () => {
    await call(null, 'GET', '/unsubscribe/SECRETTOKEN123?token=QUERYSECRET'); await settle()
    const all = lines.join('\n')
    expect(all).toContain('/unsubscribe/:token')
    expect(all).not.toContain('SECRETTOKEN123'); expect(all).not.toContain('QUERYSECRET')
  })

  test('an unknown path is logged as unmatched, without the path', async () => {
    await call(null, 'GET', '/nope/private-thing'); await settle()
    const all = lines.join('\n')
    expect(all).toMatch(/\[http\] GET unmatched 404 \d+ms/)
    expect(all).not.toContain('private-thing')
  })

  test('refusals show their status', async () => {
    await call(null, 'GET', '/me'); await settle()
    expect(lines.some((l) => /^\[http\] GET \/me 401 /.test(l))).toBe(true)
  })

  test('the health check is not logged', async () => {
    await call(null, 'GET', '/health'); await settle()
    expect(lines).toEqual([])
  })
})
