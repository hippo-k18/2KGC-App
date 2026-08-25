# Reference plates

Full-page screenshots of the **live** knowledgegraph.tech, for the development
overlay in `src/components/reference-overlay.tsx`. Turn it on with `⇧O` on any
page that has a plate.

They are committed rather than gitignored: they are the only record of what the
live site looked like on a given date, and the site changes under us. 565 KB for
a whole page is cheap for that.

## Capturing

```bash
node scripts/capture-reference.mjs            # every page
node scripts/capture-reference.mjs speakers   # just one
```

Eleven plates, all captured at 1440 on 2026-08-20: `home`, `speakers`, `about`,
`team`, `community`, `hcls`, `tickets`, `blog`, `learn`, `agenda`, `awards`.
There is no plate for `/sponsor` — the live site has no sponsor page, its nav
links straight out to a Coda prospectus, so ours is an addition rather than a
replica and there is nothing to compare it against.

Adding a page means two edits that must agree: `PAGES` in
`scripts/capture-reference.mjs` writes the file, and `PLATES` in
`src/components/reference-overlay.tsx` consumes it. A route in one and not the
other is the only way this can go quietly wrong.

## Its counterpart

```bash
node scripts/diff-styles.mjs                  # needs the dev server on 3210
```

The overlay is for spacing and alignment, which the eye is good at. `diff-styles`
is for type sizes, weights and colours, which it is not — it opens each page live
and local and prints every computed-style mismatch. It found that the nav was
wrong on all eleven pages at once, which no amount of looking had.

Treat its output as leads rather than as findings. It pairs *semantic anchors* —
first `h1`, longest paragraph, first nav link — because the live site is
WordPress and Elementor and ours is React, so there is no correspondence between
the two DOMs. When a page's first `h2` is a different piece of content on each
side, the "mismatch" is telling you nothing. The signal to trust is a difference
that repeats across many pages.

## What matters when capturing by hand

The width matters more than anything else here. A plate is only truthful at the
viewport it was captured at, because the live site is responsive and so are we —
so capture at **1440** unless you are deliberately checking another breakpoint,
and name the file with its width.

1. Open the live page in Chrome and set the viewport to `1440x900` with a
   **device pixel ratio of 1**. The DPR is not cosmetic: at DPR 2 a page this
   tall exceeds Chrome's ~16384px screenshot limit and the capture fails
   outright.
2. Scroll to the bottom and back to the top. Everything below the fold is lazy
   loaded and will otherwise photograph as blank space.
3. Neutralise anything that would smear down the plate or is not part of the
   design — sticky and fixed elements, the cookie banner:

   ```js
   document.querySelectorAll('*').forEach((el) => {
     const c = getComputedStyle(el);
     if (c.position === 'fixed' || c.position === 'sticky')
       el.style.setProperty('position', 'static', 'important');
   });
   document.querySelectorAll('[id*=cookie],[class*=cookie],[id*=consent]').forEach((e) => e.remove());
   ```

4. Take a **full-page** screenshot as WebP at quality ~82 and save it here.
5. Add the route to `PLATES` in `reference-overlay.tsx`, with the width you
   captured at and the live URL it came from.

## Reading the overlay

Set opacity to about 50% for spacing and alignment. For anything subtle, turn on
**difference blend** instead: identical pixels render black, so any glow is a
real mismatch and its colour tells you which channel is off.

Use the arrow keys to nudge the plate into alignment on a landmark near whatever
you are checking — our page and theirs are different total heights, so a plate
aligned at the header will drift by the time you reach the footer. That drift is
expected and is not itself a finding.
