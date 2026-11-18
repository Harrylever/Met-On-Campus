import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import { users } from '@moc/db'
import { db } from '../context'
import { env } from '../env'

const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#FAF9F6;color:#141413;font-family:system-ui,'Helvetica Neue',Arial,sans-serif;line-height:1.5}main{max-width:440px;margin:12vh auto;padding:0 22px}h1{font-size:26px;margin:0 0 10px}p{color:#57534E}
form{margin:24px 0 0}button{font:inherit;font-weight:600;background:#141413;color:#fff;border:0;border-radius:10px;height:48px;padding:0 22px;cursor:pointer}a{color:#141413}.dots i{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid #FAF9F6;margin-right:-6px}</style></head>
<body><main><p class="dots"><i style="background:#2563EB"></i><i style="background:#059669"></i><i style="background:#E11D48"></i> <b style="margin-left:14px">Met On Campus</b></p>${body}</main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" } },
)

const token = t.String({ format: 'uuid' })

/**
 * The unsubscribe link in alert emails. The link's token is unguessable and identifies nobody to anyone who lacks it.
 * GET only shows a button: mail scanners open links to check them, and that must not unsubscribe anyone. The button (and
 * the one-click `List-Unsubscribe-Post` mail apps send) POSTs.
 */
export const alertRoutes = new Elysia()
  .get('/unsubscribe/:token', ({ params }) => page('Turn off email alerts',
    `<h1>Turn off email alerts?</h1><p>You will stop getting "something is waiting" emails. You can turn them back on any time in Profile. Sign-in codes are not affected.</p>
     <form method="post" action="/unsubscribe/${params.token}"><button>Turn off email alerts</button></form>`), { params: t.Object({ token }) })
  .post('/unsubscribe/:token', async ({ params }) => {
    await db.update(users).set({ emailAlerts: false }).where(eq(users.unsubscribeToken, params.token))
    // Same answer for a token that matches nobody: no way to tell who is (or is not) a member.
    return page('Email alerts are off', `<h1>Email alerts are off</h1><p>You will not get "something is waiting" emails any more. Changed your mind? Turn them back on in Profile at <a href="${env.webOrigin}/profile">${env.webOrigin.replace(/^https?:\/\//, '')}</a>.</p>`)
  }, { params: t.Object({ token }) })
