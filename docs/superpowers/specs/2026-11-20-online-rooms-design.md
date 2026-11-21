# Online rooms (voice + text) design

> **Update 2026-11-21 (owner's decision): online rooms are open to everyone.** Any student can host an online room, capped at **20 minutes**. **Premium hosts** keep long calls, up to **4 hours**. Wherever this document says only premium hosts can create online rooms (or `403 premium_required`), read it as: the length cap is 20 minutes for everyone and 4 hours for premium. A too-long request answers `422 { error: 'online_too_long', maxMinutes }` (20 or 240), and `premium_required` is no longer returned. Premium is read from the host's *current* status, and only when creating a room or changing its times. Renaming a room or changing its spots never re-checks it, so a host whose premium lapsed keeps, and can still edit, a long room they already made.

Status: draft, awaiting builder check and approval. Nothing has been built.
Scope: project 1 of 2. Paying with Paystack is a separate later project (see Non-goals).

## Intent and why
Rooms and hangouts today are scheduled physical meetups at a campus spot. Students who can't be there in person, or who just want to study together from their hostel, have no equivalent. Add an **online** kind of room: a live voice huddle where people talk in real time and can also type. Anyone can host a short (20 minute) online room; premium hosts can run long ones ("host pays" for length); anyone the host approves can join for free.

## Goals
- A room is either **physical** (exactly today's behaviour) or **online**. Study and Hangout both support both.
- An online room has no place. It keeps title, tag, intent, start and end time, capacity, and the existing request/approve flow.
- Approved members (and the host) can join the voice room **only while it is live** (between its start and end time). Nobody can join before it starts or after it ends.
- Inside: voice with a mute control, a live participant list, and a text chat among the people currently in the room.
- Any student can create an online room of up to 20 minutes; only premium hosts can go longer (up to 4 hours). Premium starts as a manual flag; paying is out of scope here.
- Blocking, suspension and campus boundaries keep working exactly as they do for physical rooms.

## Non-goals / anti-goals
- No video, no screen share, no recording, no transcripts.
- No chat history: text is delivered only to people in the call at that moment and is not stored.
- Paystack and any in-app purchase flow (separate project; only the `premium_until` flag it will later set is built here).
- No payment for joining; no free-tier caps.
- No AI "agents" or bots in rooms.
- Anti-goal: a student who was never approved, was declined, is blocked by the host, is suspended, or is outside the campus must never be able to obtain a join token.
- Anti-goal: LiveKit costs running away (empty rooms lingering, very long sessions).

## Constraints
- Provider: **LiveKit Cloud** (hosted SFU), chosen by the owner. The API key and secret live only in environment variables, never in the repo or logs. The project URL is `wss://metoncampus-30wky3wj.livekit.cloud`.
- Stack stays Bun + Elysia + Drizzle (Postgres) + Redis; web is React (TanStack Start). Follow existing patterns (per-student rate limits in `LIMITS`, `limited()`, migrations via `db:generate`, tests in `apps/api/test`, `apps/e2e`).
- Schema changes must be backwards-safe and pass `bun run db:check`.
- Audio only; join tokens are issued by our API per join, short-lived.
- `main` accepts changes only through a PR.

## Approaches considered
- **LiveKit Cloud** (chosen): our API signs join tokens; the web app joins with LiveKit's client SDK; text chat uses LiveKit's data channel so no second chat system is needed. Can move to self-hosted LiveKit later without rewriting the app.
- Daily or Cloudflare Realtime: workable, rejected (less flexible custom UI / fewer ready-made chat features).
- Voice via SFU, text via our own WebSocket: rejected for now (adds storage and moderation work for ephemeral chat).
- Peer-to-peer WebRTC with no media server: rejected (breaks above ~4 people and on some campus networks).

## Design (decided by the owner unless marked as my call)
**Owner's decisions:** online and physical modes for both Study rooms and Hangouts; hosted SFU (LiveKit Cloud); voice plus text in the room; host pays for length (everyone hosts up to 20 minutes, premium hosts up to 4 hours, guests free); join only while live; premium is a manual flag first, Paystack later.

**My calls (change any of them):**
- **Data:** `rooms.mode` enum `'physical' | 'online'`, default `'physical'` (existing rows unchanged); online rooms store `place = 'Online'`. `users.premium_until` nullable timestamptz; premium means `premium_until > now()`. Staff set it from the platform/`bun run admin` (exact tool is the builder's call).
- **Creating:** `POST /rooms` accepts `mode`. Online requires LiveKit configured (`503 online_unavailable` if the three env vars are missing, like photos). An online room's length is capped at 20 minutes, or 4 hours for a premium host. A host who loses premium after creating keeps rooms they already made.
- **Joining:** new `POST /rooms/:id/join` returns `{ url, token }` for an online room only if the caller is the host or `approved`, the room is not cancelled, `startsAt <= now < endsAt`, the caller is active (not suspended), and is not blocked with the host. Otherwise 404/403/409 with a clear error (`not_live_yet`, `ended`, `not_a_member`). The token: identity = user id, display name = first name, audio publish and data publish allowed, no video, expiry = the room's end time. Tokens are not reusable beyond that; a rejoin asks for a new one. Rate limit `roomJoin` (30 per hour per student).
- **Room names:** LiveKit room name `room:<roomId>`. Cancelling a room (existing `DELETE /rooms/:id`) also closes the LiveKit room so everyone is disconnected.
- **Host control:** the host can remove someone from a live call (disconnect, and mark that member declined so they cannot rejoin). No other moderation in v1; voice and chat are never recorded, so staff cannot review what was said.
- **Rooms list:** each room includes `mode`; the web shows an "Online" tag instead of the place, and a "Join voice" button for approved members only while live.
- **Web call UI:** uses `livekit-client` directly (not the large prebuilt components package): mute/unmute, who is speaking, participant names, a simple text box with the messages since you joined, a leave button; clear states for "microphone blocked", "reconnecting" and "room ended".
- **Badges and rewards:** an online room counts the same as a physical one for "first study room/hangout" badges; no new points.
- **Privacy:** no audio, chat text or gender in logs or notifications; the join token and LiveKit secret are never logged.
- **Tests:** token contents and every refusal covered in API tests by decoding the signed token with the secret (no network); LiveKit server calls (close room, remove participant) go through one small wrapper so tests can substitute it; one end-to-end check that an approved member sees "Join voice" only while live and a non-member never does (real audio is not tested automatically).

**More of my calls (from the builder check):**
- **Ending at `endsAt`:** a join token only limits connecting, so the API also runs an in-process sweep about once a minute that closes (idempotently) the LiveKit room of any online room whose `endsAt` has passed. Duplicate sweeps on several instances are harmless. Rooms are also created with an empty-room timeout and `maxParticipants` equal to the room's capacity. If the sweep is late, an ended call can linger up to about a minute.
- **Editing an online room:** `mode` can't change after creation; `place` stays `'Online'` and can't be edited; the 4-hour cap applies to edits too; `endsAt` may be moved earlier or later mid-call (the sweep always uses the current value; a rejoin gets a token for the current end); capacity edits only change the approval limit.
- **Removing someone from a call:** `POST /rooms/:id/members/:userId/remove`, host only, for approved non-host members. It sets their status to `declined` (so it frees capacity and they cannot rejoin; because requests use "do nothing on conflict" they also cannot re-request that room, which is intended), disconnects them in LiveKit, tells them with the existing `room.decision` event, and resets `decisionSeenAt`. A host cannot remove themselves.
- **Refusals:** `404 not_found` for a missing room, another campus, a physical room, or a caller blocked with the host (no information leak); `409 cancelled`; `403 not_a_member`; `409 not_live_yet`; `409 ended`; `403 premium_required` and `503 online_unavailable` as above. A suspended caller is already refused by the existing sign-in check.
- **Premium** only raises the length cap. It is read when a room is created or its times change; joins and rooms already made keep working if premium lapses.
- **Configuration:** env vars `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, no defaults. Tests and e2e use fake values and a substituted LiveKit wrapper, so the "Join voice" button renders there. If LiveKit is not configured, the button still shows and a join says online rooms are unavailable.
- **Two tabs or devices:** the identity is the user id, so joining on a second device drops the first. One live connection per student is acceptable.

## Blocks between people in a call (owner's decision, plus my calls on the details)
**Owner's decision:** at the door, if someone you blocked is in the call, you get a prompt (roughly "Someone you blocked is in this call. Do you want to join?") and choose.

**My calls on how it works:**
- Server: `POST /rooms/:id/join` takes an optional `{ acknowledgeBlocked: boolean }`. It lists who is currently in the LiveKit room and, if any of them is someone the **caller** blocked, answers `409 { error: 'blocked_present', people: [{ name }] }` (names only, never ids). Calling again with `acknowledgeBlocked: true` issues the token. Nothing is refused because of this.
- Only blocks the caller made are considered. If someone else blocked the caller, the caller is not told and joins normally, so a block is never revealed to the person it was placed on.
- Someone already in the call whose blocked person joins later sees a banner ("Someone you blocked joined") with Leave and Stay; the app matches participant ids against the caller's own block list on the device. No server round trip and no new information about anyone else.
- A block between the caller and the **host** keeps the existing rule: the room doesn't exist for them (`404 not_found`).
- Blocking someone mid-call does not disconnect anyone (the blocker can leave or stay); a suspension does remove the person (the builder wires it to the LiveKit wrapper's remove).
- Web: the prompt is a small dialog with "Join anyway" and "Not now"; tests cover the 409 with and without acknowledgement, that names but not ids are returned, and that a blocked person is never told.

## Left to the builder
Exact UI layout and wording; how staff set `premium_until`; the wrapper's shape; reconnection behaviour; icons.
