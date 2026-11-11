# What makes a website look AI-generated

A checklist for the KGC public website. Every item is something a reader
notices without being able to name it, and every item is checkable against a
screenshot or a grep rather than against taste.

## Scope: which pages this applies to

Eleven routes are a measured replica of the live knowledgegraph.tech and have
reference plates in `apps/web/public/reference`: `home`, `speakers`, `about`,
`team`, `community`, `hcls`, `tickets`, `blog`, `learn`, `agenda`, `awards`.
**Their structure, wording and spacing are out of scope.** If they look
templated, that is the live site looking templated, and matching it is the
point. `/tickets` is the one exception in the other direction: it is a
deliberate clean-design departure and is already where the rest should get to.

Everything else in `apps/web` is ours and is in scope: `/sponsor`,
`/exhibitors`, `/startup-pitch`, `/call-for-posters`, `/documents`,
`/announcements`, `/rooms`, `/search`, `/privacy`, `/previous-events`, the
`/tickets/*` sub-pages and the token-gated pages.

The organizer dashboard is a separate replica and is not touched by any of this.

---

## 1. Layout tells

**1.1 The uniform band stack.** Every section is a full-width band, each one the
same height rhythm, alternating between white and a light tint for no reason
other than to mark that a new section started. Real sites vary section weight:
one thing dominates, the rest support it.
*Check:* count consecutive `.band` siblings whose only difference is background.

**1.2 The narrow column in a wide band.** Text sits in a ~600px column pinned
left or centred inside a 1280px band, leaving 40% of every screen empty while
the background colour runs the full width. The band promises content it does not
have.
*Check:* at 1280, is more than a third of a band's width empty on one side?

**1.3 Everything centred.** Eyebrow centred, headline centred, one-line
subtitle centred, cards centred, closing call to action centred. Centring is for
one or two moments on a page, not for a whole page.
*Check:* screenshot at 1280 and look for a single vertical axis running top to
bottom.

**1.4 The three equal cards.** Three boxes in a row, identical width, each with
a heading, two or three lines of description and a button. Nothing in the set is
more important than anything else, which is never true of real content.
*Check:* a card grid where every card has the same three elements in the same
order.

**1.5 The bottom call-to-action band.** A final tinted band with a short
headline, one sentence and a button, repeating a button already in the header.
*Check:* does the last band before the footer add information, or only repeat?

**1.6 Equal spacing everywhere.** The same vertical gap between a heading and
its paragraph as between two unrelated sections, so nothing groups. Related
things should sit closer together than unrelated things.

## 2. Copy tells

**2.1 Scaffolding headings.** "Why attend", "Why enter", "How it works", "What
you get", "Key benefits", "Getting started". These are the outline prompt left
in the page. Name the actual thing instead: "Judging is a five-minute pitch",
"Two workshop days, Monday and Tuesday".
*Check:* `grep -rniE '^\s*(<h[23][^>]*>)?\s*(why |how (it|to) |what you|key |benefits|overview|getting started)'`

**2.2 The em dash.** Already a house rule. An em dash in prose almost always
introduces a rationale clause that should have been a full stop or deleted.
*Check:* `grep -rn '—' src/app src/components` outside table empty-cell glyphs.

**2.3 Rationale clauses.** A sentence that states something, then explains why
it was stated. "Submit by 14 March, so the committee has time to review." The
reader did not ask.

**2.4 Elevated filler adjectives.** "vast", "ever-growing", "cutting-edge",
"seamless", "robust", "comprehensive", "world-class", "leading", "innovative",
"unlock", "empower", "leverage", "elevate", "dive into", "navigate the
landscape", "in today's fast-paced".
*Check:* grep the list.

**2.5 The tricolon.** "practitioners, researchers and vendors", "faster, simpler
and more reliable". Three-item lists everywhere, because the pattern generates
well. One or two real items beat three padded ones.

**2.6 Helper text that restates the control.** "Choose how many tickets you
need" under a quantity dropdown. If the control says it, delete the hint.

**2.7 Hedged non-facts.** "Dates to be announced", "coming soon", "more details
shortly" presented as content. Either give the fact or remove the section. A
line that says nothing costs the reader a stop.

**2.8 Symmetrical sentence pairs.** Two sentences of near-identical length and
shape in a row, in every card. Real writing is lumpy.

**2.9 Emoji and icon bullets as decoration.** A rocket next to "launch", a
checkmark next to every benefit. Checkmarks are fine when they mark what is
genuinely included against what is not; decorative ones are a tell.

## 3. Type tells

**3.1 Too many sizes.** More than about five distinct font sizes on one page
means the sizes were chosen per element rather than from a scale.
*Check:* the computed `font-size` set for a page.

**3.2 Headline too large for its content.** A 48px headline over two lines of
body text. Size should track importance, not section count.

**3.3 Centred multi-line paragraphs.** One centred line reads fine. Four centred
lines make a ragged blob on both edges.

**3.4 Line length outside 45 to 85 characters.** Long measure on a wide band is
the most common version.

**3.5 The eyebrow on every section.** Small uppercase letter-spaced label above
every single headline. It is a device for one section, not a template slot.

## 4. Colour and surface tells

**4.1 More than two accent uses per screen.** An orange heading, an orange
button and an orange rule in the same card group flattens the hierarchy.

**4.2 Inconsistent button colour for the same job.** Three cards in a row with
orange buttons, then two cards below with navy buttons doing the same thing.
*Check:* one screenshot, compare button fills across sibling card groups.

**4.3 Arbitrary emphasis.** One card in a row filled with a colour while its
siblings are white, with no reason in the content.

**4.4 Gradients, glow and heavy shadow.** Purple-to-blue gradients, glassy
cards, large soft drop shadows. Not in this site's language at all.

**4.5 Borders and fills both.** A card with a border, a tinted fill and a shadow
is three ways of saying the same edge. Pick one.

## 5. Content tells

**5.1 Placeholder sections that ship.** A "Sponsors" heading over four empty
tiers, a hotel list with no hotels. An empty section is worse than no section:
it advertises that nothing is there.
*Check:* screenshot every page and look for a heading with no content under it.

**5.2 Round invented numbers.** "10,000+ members", "100+ sessions". Give the
real number or give none.

**5.3 Repeating the same call to action four times** on one page in four
visual styles.

**5.4 Generic stock imagery** where a photograph of the actual event exists.

## 6. How to fix without breaking things

- Fix the shared component or the shared class once. Three pages with the same
  band problem is one `.band` change, not three page edits.
- Cut before you add. Most of this list is removals: a deleted band, a deleted
  hint, a deleted adjective.
- Do not rename nav entries, page titles or routes.
- Phone-only changes go inside `@media (max-width: 767px)`.
- Re-screenshot at 390 and 1280 and confirm `horizontalScroll` is false.
