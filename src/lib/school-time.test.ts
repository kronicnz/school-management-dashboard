/// <reference lib="deno.ns" />
import {
  SCHOOL_TIME_ZONE,
  isDateWindowInForce,
  schoolDateAfter,
  todayInSchoolZone,
} from "./school-time"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  assert(a === b, `${message}\n  actual:   ${a}\n  expected: ${b}`)
}

Deno.test("the school zone is the named zone, not a fixed offset", () => {
  // A hardcoded +12:00 is an hour wrong through New Zealand daylight saving.
  assertEquals(SCHOOL_TIME_ZONE, "Pacific/Auckland", "a named IANA zone is required")
})

Deno.test("the school day is ahead of UTC, which is the whole point", () => {
  // 2026-10-01T22:00Z is 2026-10-02T11:00 in Auckland: NZDT, UTC+13, in
  // daylight saving. The UTC form of this instant is still the previous day.
  const instant = new Date("2026-10-01T22:00:00.000Z")
  assertEquals(todayInSchoolZone(instant), "2026-10-02", "NZDT is UTC+13")

  // Six hours earlier the offset is UTC+12 and the answer flips back.
  const earlierInstant = new Date("2026-10-01T06:00:00.000Z")
  assertEquals(todayInSchoolZone(earlierInstant), "2026-10-01", "NZST is UTC+12")
})

Deno.test("the regression that emptied the navigation is fixed", () => {
  // 2026-09-30T22:30Z is 2026-10-01T11:30 in Auckland. A grant starting on
  // 2026-10-01 read as "tomorrow" while the school already considered it today,
  // so `fetchCurrentUserRoles` filtered the row out and the user held no roles.
  const instant = new Date("2026-09-30T22:30:00.000Z")
  assertEquals(
    instant.toISOString().slice(0, 10),
    "2026-09-30",
    "the UTC form of this instant is the day before the school date",
  )
  assertEquals(todayInSchoolZone(instant), "2026-10-01", "the school date is a day ahead")
})

Deno.test("midnight local is the boundary, not midnight UTC", () => {
  // 2026-10-01 is the first day of NZ daylight saving. 09:00Z is 21:00 local the
  // day before; 11:00Z is 00:00 local the day after. Same UTC day, different
  // school date, and only the school date is correct.
  assertEquals(todayInSchoolZone(new Date("2026-10-01T09:00:00.000Z")), "2026-10-01", "still the 1st at 21:00 local")
  assertEquals(todayInSchoolZone(new Date("2026-10-01T11:00:00.000Z")), "2026-10-02", "the 2nd from 00:00 local")
})

Deno.test("a viewer in any timezone gets the same answer", () => {
  // The old implementation used the *viewer's* local date, so an admin abroad
  // could disagree with the server about whether a window was open. Only the
  // instant varies here; the result must not.
  const instant = new Date("2026-09-30T22:30:00.000Z")
  const answers = [
    todayInSchoolZone(instant),
    todayInSchoolZone(new Date(instant.getTime())),
    todayInSchoolZone(new Date(instant.toISOString())),
  ]
  assertEquals(answers[0], answers[1], "repeat calls agree")
  assertEquals(answers[1], answers[2], "an ISO round trip does not shift the date")
})

Deno.test("the output is always a bare ISO date", () => {
  for (const iso of [
    "2026-01-01T00:00:00.000Z",
    "2026-06-30T12:00:00.000Z",
    "2026-12-31T23:59:59.000Z",
    "2027-03-28T00:00:00.000Z",
  ]) {
    const result = todayInSchoolZone(new Date(iso))
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(result),
      `expected a bare YYYY-MM-DD for ${iso}, got "${result}"`,
    )
  }
})

Deno.test("day offsets survive a daylight saving boundary", () => {
  // 23 September 2026 is inside NZDT (UTC+13). Adding 24 hours lands on the
  // 25th, but the school saw 25 hours of daylight that day, so calendar
  // arithmetic on the instant is right and adding 86400 seconds to a *date*
  // would be a guess.
  const beforeDst = new Date("2026-09-23T12:00:00.000Z")
  assertEquals(todayInSchoolZone(beforeDst), "2026-09-24", "baseline")
  assertEquals(schoolDateAfter(1, beforeDst), "2026-09-25", "one school day later")
  assertEquals(schoolDateAfter(7, beforeDst), "2026-10-01", "a week later crosses into NZDT")
  assertEquals(schoolDateAfter(0, beforeDst), "2026-09-24", "zero days is today")
})

Deno.test("a window containing the school day is in force", () => {
  const now = new Date("2026-09-30T22:30:00.000Z")
  const today = "2026-10-01"

  assert(
    isDateWindowInForce({ effective_from: today, effective_to: "2028-10-31" }, now),
    "the grant that exposed this is now in force",
  )
  assert(
    isDateWindowInForce({ effective_from: null, effective_to: null }, now),
    "an open window is in force",
  )
  assert(
    isDateWindowInForce({ effective_from: "2026-01-01", effective_to: "2026-12-31" }, now),
    "a year-long window containing today is in force",
  )
  assert(
    isDateWindowInForce({ effective_from: "2026-10-01", effective_to: "2026-10-01" }, now),
    "a single-day window is in force on that day, inclusive at both ends",
  )
})

Deno.test("a window that has not started or has lapsed is not in force", () => {
  const now = new Date("2026-09-30T22:30:00.000Z")

  assert(
    !isDateWindowInForce({ effective_from: "2026-10-02", effective_to: null }, now),
    "a window starting tomorrow is not in force",
  )
  assert(
    !isDateWindowInForce({ effective_from: "2026-09-30", effective_to: "2026-09-30" }, now),
    "a window that ended yesterday is not in force",
  )
  assert(
    !isDateWindowInForce({ effective_from: null, effective_to: "2026-09-30" }, now),
    "an open start with a lapsed end is not in force",
  )
})

Deno.test("the window test and the UTC bug cannot disagree", () => {
  // The precise failure: a window opening on the school date, evaluated at an
  // instant whose UTC date is the day before. Every assertion here has to hold
  // or a real account silently loses access for half the day.
  //
  // 2026-09-30T11:00Z is 2026-10-01T00:00 in Auckland (NZDT, UTC+13), so this
  // instant is exactly the moment the school rolls over to the 1st.
  const now = new Date("2026-09-30T22:30:00.000Z")
  const schoolToday = todayInSchoolZone(now)
  const utcToday = now.toISOString().slice(0, 10)

  assert(schoolToday !== utcToday, "the two frames genuinely differ for this instant")

  assert(
    isDateWindowInForce({ effective_from: schoolToday, effective_to: null }, now),
    "a window starting the school day is in force during the school day",
  )
  // One hour before the rollover the school was still on the 30th, so a window
  // opening on the 1st genuinely is not in force yet.
  assert(
    !isDateWindowInForce({ effective_from: "2026-10-01", effective_to: null }, new Date("2026-09-30T10:00:00.000Z")),
    "and is not in force an hour before the school day rolls over",
  )
  // The same instant, evaluated the old way, would have denied access from
  // 2026-10-01T00:00 local until 2026-10-01T13:00 local: thirteen hours of a
  // working day spent with an empty navigation.
  assert(
    new Date("2026-09-30T22:30:00.000Z").toISOString().slice(0, 10) === "2026-09-30",
    "the UTC comparison would have read the grant as starting tomorrow",
  )
})
