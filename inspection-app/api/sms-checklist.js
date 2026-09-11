// Daily checklist texts: the same jobs, to the same man, at the same time.
//
// WHY THE CRON RUNS EVERY 15 MINUTES INSTEAD OF ONCE A DAY
// The nudge cron next door fires once, at a fixed UTC hour, because "sometime
// today" is good enough for a list of cars that have sat three weeks. A
// checklist is not that: 4:30pm means 4:30pm, people work different shifts, and
// a fixed UTC hour drifts an hour every time daylight saving moves. So this runs
// often and decides locally — each row carries its own Memphis wall-clock time,
// and a row is sent at most once per local date (last_sent_on). That makes the
// schedule per-person, DST-proof, and cheap to miss: a skipped run costs fifteen
// minutes, not the day.
//
// Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET,
//               TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM

import { sendSms } from './_lib/sms.js'

const ZONE = 'America/Chicago'

// How late a reminder may still go out. A 9:10am "put your hands on the new
// cars" that escapes until 8pm is not a reminder any more, it's a text nobody
// can act on — and acting on it is the whole point. Past the window the row is
// left alone and tomorrow's run takes it.
const CATCHUP_MINUTES = 120

// How early a reminder may go out, in minutes.
//
// WHY THIS EXISTS: a cron tick is not punctual. Vercel fires "*/15" a few
// seconds either side of the minute, and almost every time on this roster sits
// exactly on a tick boundary — 8:00, 11:00, 14:00, 14:30, 15:00, 15:30, 16:30.
// With a plain `now >= due` test, an invocation landing at 10:59:58 reads an
// 11:00 row as "due in 1m" and the text then waits for the NEXT tick: fifteen
// minutes late, every time the jitter goes the wrong way. Chris's 11:00 list
// was missed exactly this way on the first day.
//
// Two minutes is enough to swallow that jitter and is invisible to the man
// reading it — nobody notices a reminder arriving 90 seconds early, everybody
// notices the 9:00 one showing up at 9:15. The last_sent_on dedupe still caps
// it at one send per local date, so being early can never mean being twice.
const EARLY_GRACE_MINUTES = 2

const ISO_DAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

function sb(path, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

// The clock everything here is judged against. Read in Memphis, never UTC:
// the date, the weekday and the minute all have to agree with the wall clock
// the crew is looking at, and on a 4:30pm send a UTC date is already tomorrow.
function memphisNow(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    isoDay: ISO_DAY[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

// '16:30:00' → 990. Postgres hands back seconds; nothing here cares about them.
function minutesOf(time) {
  const [h, m] = String(time || '').split(':')
  return Number(h) * 60 + Number(m)
}

// One item reads as a sentence, several read as a list. Numbering a single
// instruction just makes it look like something is missing.
//
// The header is a plain hyphen, not the em dash the nudge texts use, and that is
// not a typo. A dash outside the GSM-7 alphabet switches the whole message to
// UCS-2, which cuts a segment from 153 characters to 67 — Chris's four-item
// morning list is 266 characters, so the em dash alone took it from two
// segments to four. Every character below this line should stay ASCII.
function buildMessage(person) {
  const items = (person.items || []).map((s) => String(s).trim()).filter(Boolean)
  if (!items.length) return null
  const head = `Carz Inc - ${person.name}:`
  if (items.length === 1) return `${head}\n${items[0]}`
  return [head, ...items.map((s, i) => `${i + 1}. ${s}`)].join('\n')
}

export default async function handler(req, res) {
  // Vercel cron sends the project's CRON_SECRET as a bearer token. A manual run
  // can pass ?secret= instead, so this can be tested without waiting for 4:30.
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const ok = !secret || auth === `Bearer ${secret}` || req.query?.secret === secret
  if (!ok) return res.status(401).json({ error: 'unauthorized' })

  const dryRun = req.query?.dry === '1' || !process.env.TWILIO_ACCOUNT_SID
  // ?force=1 ignores the day and the clock — it's how you see the real text
  // without waiting for its hour to come round. It still respects last_sent_on
  // unless ?again=1, so a forced test can't double-text the crew by accident.
  const force = req.query?.force === '1'
  const again = req.query?.again === '1'
  // ?only=<last digits> sends to one person. The first live run shouldn't text
  // everybody to prove the wiring works.
  const only = String(req.query?.only || '').replace(/\D/g, '')

  const now = memphisNow()

  try {
    const rows = await sb('sms_checklists?select=*&active=eq.true&order=send_at').then((r) => r.json())
    if (!Array.isArray(rows)) {
      return res.status(500).json({ error: 'could not read sms_checklists', rows })
    }

    const results = []
    for (const person of rows) {
      const label = `${person.name} @ ${String(person.send_at).slice(0, 5)}`

      if (only && !String(person.phone).replace(/\D/g, '').endsWith(only)) continue

      if (!again && person.last_sent_on === now.date) {
        results.push({ name: label, skipped: 'already sent today' })
        continue
      }
      if (!force) {
        if (!(person.days || []).includes(now.isoDay)) {
          results.push({ name: label, skipped: 'not a work day for him' })
          continue
        }
        const due = minutesOf(person.send_at)
        if (now.minutes < due - EARLY_GRACE_MINUTES) {
          results.push({ name: label, skipped: `due in ${due - now.minutes}m` })
          continue
        }
        if (now.minutes - due > CATCHUP_MINUTES) {
          results.push({ name: label, skipped: `${now.minutes - due}m late — past the window` })
          continue
        }
      }

      const body = buildMessage(person)
      if (!body) {
        results.push({ name: label, skipped: 'no items on the list' })
        continue
      }

      if (dryRun) {
        results.push({ name: label, to: person.phone, dryRun: true, body })
        continue
      }

      const out = await sendSms(person.phone, body, { name: person.name, source: 'checklist' })
      results.push({ name: label, to: person.phone, ...out })
      await sb(`sms_checklists?id=eq.${person.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(
          out.sent
            ? { last_sent_on: now.date, last_sent_at: new Date().toISOString(), last_error: null }
            : { last_error: String(out.reason).slice(0, 500) },
        ),
      })
    }

    return res.status(200).json({ dryRun, local: now, count: results.length, results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
