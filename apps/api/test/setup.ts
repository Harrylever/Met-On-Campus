// Runs before every test file. Must set env BEFORE anything imports src/context.
const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/metoncampus_test'
// Hard stop: these tests TRUNCATE tables and flush Redis. Never let them near a real database.
if (!/_test(\?|$)/.test(url)) throw new Error(`Refusing to run tests against "${url}". The database name must end in _test.`)
process.env.DATABASE_URL = url
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15'
process.env.RESEND_API_KEY = ''   // codes go to devOutbox, never a real inbox
process.env.NODE_ENV = 'test'
process.env.TRUST_PROXY = 'false'
// Platform (staff) app
process.env.ADMIN_API_TOKEN = 'test-service-token-0123456789abcdef0123456789abcdef'
process.env.PLATFORM_ADMIN_EMAILS = 'root@platform.test,second@platform.test'
process.env.PLATFORM_URL = 'https://platform.test'
