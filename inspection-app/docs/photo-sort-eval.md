# Which model sorts the photos

`api/_lib/photoSort.js` labels every listing photo with Claude and orders the
gallery from those labels. This is the record of why it runs on
`claude-haiku-4-5` and not something more expensive, measured on real cars off
our own lot rather than on a guess.

## What was measured

Three cars, chosen because their photos come from the three sources that never
agreed on an order:

| Stock | Car | Photos | Source |
|---|---|---|---|
| 06-370-26 | 2024 Hyundai Ioniq 5 | 30 | SmartAuction condition report (`sa_photo_*`) |
| 08-134-26 | 2021 Lexus NX | 20 | Telegram ready-to-sell walkaround (`rts*`) |
| 08-138-26 | 2018 Audi A5 | 49 | Telegram, damage-heavy — 30 close-ups after the walkaround |

Each set was labelled by Haiku 4.5, Sonnet 5 and Opus 5 through the same prompt,
then rebuilt as a contact sheet in the order it proposed and read by eye.

## Result

| | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|
| Cost, 30-photo car | **$0.05** | $0.12 | $0.27 |
| Time, 30-photo car | **5s** | 20s | 14s |
| Labels matching Opus (Ioniq) | 25/30 | 28/30 | — |
| Labels matching Opus (Audi, first prompt) | 36/49 | — | — |
| Labels matching Opus (Audi, shipped prompt) | **42/49** | — | — |
| Exterior walkaround correct, all three cars | **every photo** | every photo | every photo |

The last row is the one that decided it. Every disagreement between Haiku and
Opus was a close-up — a hazy patch of grey paint, a dark boot liner, a wall — and
those sit in the tail of the gallery whichever label wins. On the hero angles, the
part of a listing everybody sees, the three models were indistinguishable.

Sonnet and Opus also disagreed with **each other** on two of the five contested
Ioniq photos, which is the clearest evidence that the remaining gap is
photograph ambiguity rather than model capability. Paying five times more does
not buy an answer on a photograph that has no answer.

## The two things Haiku got wrong, and what was done about them

**Close-ups promoted into the hero band.** Three of the Audi's paint shots came
back `exterior_side` — a door filling the frame, with sky and trees reflected in
it. That put a close-up second in the gallery, which is the one error a buyer
cannot miss. Two changes: the prompt now demands the whole car end-to-end for any
`exterior_` label, and a second pass re-asks about just the photos claiming to be
whole-car shots as a plain yes/no. Six to nine images, a fraction of the first
pass, and the promotions stopped. Agreement with Opus on the Audi went 36 → 42 of
49.

**Good photos called junk.** Four sun-blown close-ups of the Audi's grey paint
came back `junk`, quality `unusable`. On a grey car, hazy paint *is* the damage
the photograph was taken to record, and hiding those deletes evidence a wholesale
buyer is owed — silently. So nothing is hidden automatically at all: a `junk`
label sinks a photo to the bottom of the gallery and no further. Removing a photo
stays a person's decision in Edit Photos. See the comment in `sortPhotos`.

## What it costs to run

$0.05 a car, once. Labels are cached per photo URL in `listing_photo_tags`, so a
re-sort of an unchanged car costs nothing — verified: a second run of the Ioniq
reported `classified: 0, cached: 30, usage: 0 tokens`. That is what makes a
quarter-hourly sweep affordable; it only ever pays for photographs it has not
seen. The first pass over the whole lot — 25 cars, about 700 photos — cost
roughly $1.35.

## Re-running this

```
curl -X POST "https://www.carzinc.ai/api/photo-sort?vin=<VIN>&dry=1&model=claude-sonnet-5&secret=$CRON_SECRET"
```

`dry=1` labels and sorts without writing, and `model=` overrides the classifier
on dry runs only — a write always uses `DEFAULT_MODEL`, because a lot labelled by
several different models, cached permanently, is worse than a lot labelled
consistently by a cheap one.
