import { inArray } from "drizzle-orm"
import {
  createDb,
  users,
  intentProfiles,
  rooms,
  roomMembers,
  conversations,
  messages,
  connectionRequests,
} from "./index"

// Dev seed: the cast from the design. Idempotent: re-running wipes and recreates these users only.
// Sign in as any of them by requesting a code for their address (printed in the API console).
const db = createDb()
const U = "futminna"
const email = (n: string) => `${n.toLowerCase()}@st.futminna.edu.ng`
const min = (m: number) => new Date(Date.now() + m * 60_000)

type Seed = {
  name: string
  department: string
  level: number
  modes: Partial<
    Record<
      "study" | "friends" | "romance",
      {
        prompt: string
        bio: string
        tags: string[]
        free: string
        spot: string
        hide?: boolean
      }
    >
  >
}
const CAST: Seed[] = [
  {
    name: "Amina",
    department: "Cyber Security",
    level: 400,
    modes: {
      study: {
        prompt:
          "Looking for a partner to review network security past questions.",
        bio: "Final-year student. Prefers quiet tables and timed practice.",
        tags: ["CSS 411", "CSS 423"],
        free: "Mon, Wed and Fri after 2:00 PM",
        spot: "University Library",
      },
      friends: {
        prompt: "Chess at lunch, anyone?",
        bio: "Slow at chess, fast at jollof.",
        tags: ["Chess club", "Food"],
        free: "Lunch hours",
        spot: "Student Union Cafeteria",
      },
    },
  },
  {
    name: "Tunde",
    department: "Computer Science",
    level: 300,
    modes: {
      study: {
        prompt: "Need two people for the CPT 315 group assignment before Friday.",
        bio: "Handles the backend on most group assignments. Brings a spare charger.",
        tags: ["CPT 315", "CSS 411", "Group project"],
        free: "Weekdays after 2:00 PM",
        spot: "ICT Centre",
      },
    },
  },
  {
    name: "Hauwa",
    department: "Cyber Security",
    level: 400,
    modes: {
      study: {
        prompt: "Linear algebra problem sets, evenings.",
        bio: "Likes whiteboards.",
        tags: ["MTH 221", "CSS 411"],
        free: "Evenings",
        spot: "Faculty Quad",
      },
    },
  },
  {
    name: "Ibrahim",
    department: "Electrical Engineering",
    level: 400,
    modes: {
      friends: {
        prompt:
          "Football at the school field on Saturdays. We need a goalkeeper.",
        bio: "Plays midfield, loses at chess, shows up on time.",
        tags: ["Football", "Chess club"],
        free: "Saturdays from 4:00 PM",
        spot: "School Field",
      },
    },
  },
  {
    name: "Ngozi",
    department: "Computer Science",
    level: 200,
    modes: {
      friends: {
        prompt: "New on campus. Looking for people to try the cafeterias with.",
        bio: "Transferred in this session. Likes old Nollywood.",
        tags: ["Food", "Film nights"],
        free: "Lunch hours, most days",
        spot: "Student Union Cafeteria",
      },
    },
  },
  {
    name: "Zainab",
    department: "Information Technology",
    level: 400,
    modes: {
      romance: {
        prompt: "Someone to gist with after evening lectures.",
        bio: "Writes on weekends. Prefers long conversations to loud places.",
        tags: ["Afrobeats", "Poetry"],
        free: "Evenings after 5:00 PM",
        spot: "Faculty Quad",
      },
      friends: {
        prompt: "Open mic planning.",
        bio: "",
        tags: ["Poetry", "Film nights"],
        free: "Weekends",
        spot: "Senate Building Lounge",
      },
    },
  },
  {
    name: "Emeka",
    department: "Electrical Engineering",
    level: 500,
    modes: {
      romance: {
        prompt:
          "A cold drink at the Senate Building Lounge and an honest conversation.",
        bio: "Final-year engineer. Makes a careful cup of coffee.",
        tags: ["Coffee", "Long walks", "Poetry"],
        free: "Weekend mornings",
        spot: "Senate Building Lounge",
        hide: true,
      },
    },
  },
]

const emails = CAST.map((c) => email(c.name))
await db.delete(users).where(inArray(users.email, emails)) // cascades to everything below

const rows = await db
  .insert(users)
  .values(
    CAST.map((c) => ({
      email: email(c.name),
      university: U,
      name: c.name,
      department: c.department,
      level: c.level,
      verifiedAt: new Date(),
    })),
  )
  .returning()
const id = (n: string) => rows.find((r) => r.name === n)!.id

await db.insert(intentProfiles).values(
  CAST.flatMap((c) =>
    Object.entries(c.modes).map(([intent, m]) => ({
      userId: id(c.name),
      intent: intent as "study",
      enabled: true,
      prompt: m!.prompt,
      bio: m!.bio,
      tags: m!.tags,
      usuallyFree: m!.free,
      usualSpot: m!.spot,
      hideFromDepartment: !!m!.hide,
    })),
  ),
)

const R = (
  intent: "study" | "friends",
  host: string,
  tag: string,
  title: string,
  place: string,
  start: number,
  end: number,
  capacity: number,
  members: string[],
) => ({ intent, host, tag, title, place, start, end, capacity, members })
const ROOMS = [
  R(
    "study",
    "Amina",
    "CSS 411",
    "Network Security Past Questions",
    "University Library",
    -45,
    90,
    5,
    ["Hauwa"],
  ),
  R(
    "study",
    "Tunde",
    "CPT 315",
    "Database Design Group Project",
    "ICT Centre",
    120,
    240,
    4,
    [],
  ),
  R(
    "study",
    "Hauwa",
    "MTH 221",
    "Linear Algebra Problem Set",
    "Faculty Quad",
    240,
    330,
    2,
    ["Amina"],
  ),
  R(
    "friends",
    "Ibrahim",
    "Football",
    "Five-a-Side Kickabout",
    "School Field",
    -30,
    120,
    10,
    ["Ngozi"],
  ),
  R(
    "friends",
    "Ngozi",
    "Food",
    "Cafeteria Lunch Table",
    "Student Union Cafeteria",
    1440,
    1500,
    6,
    [],
  ),
] as const
for (const r of ROOMS) {
  const [room] = await db
    .insert(rooms)
    .values({
      intent: r.intent,
      hostId: id(r.host),
      university: U,
      tag: r.tag,
      title: r.title,
      place: r.place,
      startsAt: min(r.start),
      endsAt: min(r.end),
      capacity: r.capacity,
    })
    .returning()
  await db
    .insert(roomMembers)
    .values([
      { roomId: room!.id, userId: id(r.host), status: "approved" as const },
      ...r.members.map((m) => ({
        roomId: room!.id,
        userId: id(m),
        status: "approved" as const,
      })),
    ])
}

const order = (a: string, b: string) =>
  id(a) < id(b) ? ([id(a), id(b)] as const) : ([id(b), id(a)] as const)
async function thread(
  intent: "study" | "friends" | "romance",
  from: string,
  to: string,
  msgs: (
    | { me: boolean; text: string }
    | { me: boolean; where: string; when: Date }
  )[],
) {
  const [a, b] = order(from, to)
  await db
    .insert(connectionRequests)
    .values({ intent, fromUserId: id(from), toUserId: id(to) })
  const [c] = await db
    .insert(conversations)
    .values({ intent, userAId: a, userBId: b })
    .returning()
  let t = Date.now() - msgs.length * 60_000
  for (const m of msgs) {
    const sender = id(m.me ? from : to)
    t += 60_000
    await db
      .insert(messages)
      .values(
        "text" in m
          ? {
              conversationId: c!.id,
              senderId: sender,
              kind: "text",
              body: m.text,
              createdAt: new Date(t),
            }
          : {
              conversationId: c!.id,
              senderId: sender,
              kind: "meetup",
              meetupWhere: m.where,
              meetupWhen: m.when,
              meetupStatus: "pending",
              createdAt: new Date(t),
            },
      )
  }
}
// Tunde -> Amina so signing in as Amina shows an incoming proposal to accept.
await thread("study", "Tunde", "Amina", [
  {
    me: true,
    text: "Hi, I saw your card. Are you still reviewing CSS 411 past questions?",
  },
  { me: false, text: "Yes. I have the last two years printed." },
  { me: true, text: "Good. Can we go through them together today?" },
  { me: true, where: "University Library", when: min(180) },
])
await thread("friends", "Ibrahim", "Amina", [
  {
    me: true,
    text: "We need a keeper on Saturday. Kickoff is 4:30 PM at the school field.",
  },
])
await thread("romance", "Emeka", "Zainab", [
  { me: true, text: "I liked your answer about evening walks." },
  { me: true, where: "Faculty Quad", when: min(1500) },
])

console.log(
  `seeded ${rows.length} users, ${ROOMS.length} rooms. Sign in with e.g. ${email("Amina")} (code prints in the API console).`,
)
await db.$client.end()
