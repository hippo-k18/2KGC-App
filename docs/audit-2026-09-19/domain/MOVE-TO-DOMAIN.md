# Moving the website to knowledgegraph.tech

Written 2026-09-23. Everything about the current domain in this document was
read from live DNS and the live site on that date, not from memory.

This is a set of instructions for the owner. Nothing here has been done. The
repository work that could be done without touching anything live is done and is
described at each step.

---

## The one thing that can go wrong

knowledgegraph.tech publishes **926 addresses** today. Search engines, old
newsletters, printed conference programmes, LinkedIn posts and other people's
blogs all point at them. The moment the domain stops pointing at the WordPress
server and starts pointing at the new site, every one of those addresses either
lands somewhere sensible or says "page not found".

A page that says "page not found" for a few weeks does not just annoy a visitor.
Google drops it, and the standing that address built up since 2019 goes with it.
Recovering it means earning the links again.

That is what the redirect map is for. It is a file in the repository,
`apps/web/public/_redirects`, that lists every old address and where it now
goes. It was checked against all 926 addresses:

| | |
|---|---|
| Answered unchanged by the new site | 81 |
| Sent somewhere sensible by the redirect map | 845 |
| Left with nowhere to go | 0 |

The 81 that need no redirect are the eleven pages whose addresses already match
(`/`, `/agenda`, `/blog`, `/call-for-posters`, `/code-of-conduct`,
`/community`, `/hcls`, `/kgc-lifetime-achievement-awards`, `/startup-pitch`,
`/team`, `/tickets`) and the 70 blog articles, whose addresses were copied from
the old site on purpose when the blog was built.

The full list of old addresses is in `live-urls.txt` beside this file.

### What the redirects cannot fix

Three honest losses. None of them is a reason to delay, but somebody should know
about them before they are discovered.

**348 speaker pages all land on one page.** The old site gives every speaker
since 2019 a page of their own. The new site has a single speakers page and no
page per person, so every one of those 348 addresses arrives at
`/speakers`. A visitor looking for one named person gets a grid of a hundred
and thirty others and has to use the search box. This is the largest group of
addresses on the old site and it is the weakest landing in the map. Fixing it
properly means building a page per speaker, which is a build, not a redirect.

**125 old agenda items and 24 gallery items land on `/previous-events`.** Those
pages hold session descriptions and photographs from 2019 to 2021 that exist
nowhere else. The content is not being carried over. If any of it matters,
somebody should copy it out of WordPress before the server is switched off.

**The 70 blog articles on the new site are summaries, not the articles.** Each
one shows the title, author, date and opening paragraph and then links to the
full text on knowledgegraph.tech. That link points at the old WordPress. Once
the domain moves, it points back at the summary page the reader is already on.
See "What we change in the repository" below. This has to be dealt with in the
same release as the domain move, not after it.

---

## What is there today

Read from live DNS on 2026-09-23.

| | |
|---|---|
| Nameservers | `ns1.digitalocean.com`, `ns2`, `ns3` |
| `knowledgegraph.tech` | A record to `142.93.180.72` |
| `www.knowledgegraph.tech` | A record to the same `142.93.180.72` |
| `hub.knowledgegraph.tech` | A record to `44.223.3.28`, a different service |
| Mail | five Google Workspace MX records |
| `_dmarc` | `v=DMARC1; p=none;` |

Three TXT records sit on the root:

```
v=spf1 include:_spf.google.com include:146314187.spf03.hubspotemail.net -all
google-site-verification=lnKEcepBo09eUXgKpX3ZrsXA1itSy1qcN7hri94T9Tg
stripe-verification=1127d6bac439fe8abc88d78068b1c646c01800f9935bb534ec08b323acb031b5
```

Note `www` is an A record, not an alias. Both names point directly at the
WordPress server, so both have to be changed.

### What must not be disturbed

- **The five MX records.** Delete one by accident and company email stops.
- **The SPF record.** It ends in `-all`, which means "mail from anywhere not
  listed here is forged, reject it". Break it and mail sent through Google or
  HubSpot starts landing in spam. Do not edit it as part of this move.
- **The Stripe verification record.** Stripe checks it to confirm the domain is
  yours.
- **The Google verification record.** Removing it can drop access to Search
  Console, which is the tool used below to confirm the move worked.
- **`hub.knowledgegraph.tech`.** A separate service on a separate address. The
  new site links to it. Leave its record alone.

### What is not there, and matters

**Resend has no records on this domain at all.** Checked: no `send`
subdomain, no `resend._domainkey`, nothing. That is why the site can only send
mail to one address today. Setting Resend up is a separate job from the domain
move and is listed at the end.

---

## Do it in this order

### Step 1. Decide which name is the real one

Recommendation: **`www.knowledgegraph.tech`**, with the bare
`knowledgegraph.tech` redirecting to it.

Not a matter of taste. All 926 indexed addresses are on `www`. Making `www` the
main name means those addresses change by one redirect instead of two, and the
site's own address in its search listings does not change at all.

Nothing to do in the repository.

### Step 2. Put the redirect map live on the current address first

The redirect map is already written and is in the branch. Deploy it to the
existing Netlify address **before** any DNS changes, so the rules can be tested
on a site nobody is relying on yet.

*In the repository:* nothing further. `apps/web/public/_redirects` is in place.

*Verify:* visit these on the current Netlify address and confirm each lands
where the third column says, with the address bar showing the new path.

| Visit | Should land on |
|---|---|
| `/about-kgc/` | `/about` |
| `/2026-speakers/` | `/speakers` |
| `/blog/speakers/ora-lassila/` | `/speakers` |
| `/conference-2019/schedule/` | `/previous-events` |
| `/blog/category/kgc-talks/` | `/blog` filtered to KGC Talks |
| `/the-knowledge-graph-conference-kgc/price-table/` | `/tickets` |
| `/blog/tag/ai/` | `/blog` |
| `/blog/knowledge-graph-news-roundup-5-september-2025/` | the same article, no redirect |
| `/api/stripe/webhook` | unchanged, not redirected |

That last row is the one to check carefully. Stripe posts to that address and
signs what it sends. A redirect there breaks ticket fulfilment silently.

*Roll back:* promote the previous deploy in Netlify. One click, no DNS
involved.

### Step 3. Add the domain to Netlify, without pointing it there yet

In Netlify, on the website site, add `www.knowledgegraph.tech` as a custom
domain and set it as the primary one. Add `knowledgegraph.tech` as well.
Netlify will show both as "awaiting external DNS". That is expected and nothing
changes for visitors.

Netlify will display the exact DNS values it wants. **Use the values Netlify
shows you, not the ones written here.** They are written here so the shape is
familiar, not so they can be copied blind.

*In the repository:* nothing.

*Verify:* the two domains appear in Netlify's domain list. The live site is
untouched.

*Roll back:* remove the domains from Netlify.

### Step 4. Change two DNS records at DigitalOcean

This is the moment the site changes for everybody. Do it on a weekday morning,
not a Friday evening.

**Before touching anything, take a screenshot of the whole DNS record list.**
That screenshot is the rollback plan.

Lower the TTL on both records to 300 seconds at least an hour beforehand. A TTL
is how long the rest of the internet is allowed to remember an answer. Lowering
it first means a mistake can be undone in five minutes rather than a day.

Then make exactly these two changes:

| Name | Type | Change from | Change to |
|---|---|---|---|
| `www` | A | `142.93.180.72` | delete it |
| `www` | CNAME | does not exist | the target Netlify shows, typically `<site-name>.netlify.app` |
| `@` (the bare domain) | A | `142.93.180.72` | Netlify's load balancer address, which Netlify shows you |

Everything else stays exactly as it is. The five MX records, all three TXT
records, `_dmarc` and `hub` are not touched.

*In the repository:* nothing yet. The site is served from the same build.

*Verify, in this order:*

1. `https://www.knowledgegraph.tech/` shows the new site with a valid
   certificate. Netlify issues the certificate automatically once DNS points at
   it, which can take a few minutes.
2. `https://knowledgegraph.tech/` redirects to the `www` address.
3. Run the same table of addresses from step 2 against the real domain.
4. Send an email from a company address to an outside address, and reply to it.
   Mail is the thing that breaks quietly.
5. `https://hub.knowledgegraph.tech/` still works.

*Roll back:* put the `www` A record back to `142.93.180.72`, delete the CNAME,
and put the bare domain's A record back to `142.93.180.72`. With a 300 second
TTL the old site is back within minutes. **Do not switch the WordPress server
off until several weeks after the move.** It is the only rollback that exists.

### Step 5. Tell the new site its own address, and fix the links that assumed the old one

The site is now answering on the right domain but still thinks it lives at its
Netlify address. That is not cosmetic. The address it thinks it has is the one
it prints inside social media cards, inside the machine-readable event data that
search engines republish, and inside every link it emails to a ticket buyer.

*In the repository, one release containing all of this:*

| File | What changes |
|---|---|
| `apps/web/netlify.toml` | `WEB_PUBLIC_ORIGIN` becomes `https://www.knowledgegraph.tech` |
| `apps/organizer/netlify.toml` | the same value, for the same reason |
| `apps/web/src/app/previous-events/page.tsx` | the seven links to past conferences point at the old WordPress pages. Those pages will no longer exist, and the redirect map sends them back to this very page. Seven links that loop. They need real destinations or they need removing. |
| `apps/web/src/lib/posts.ts` | 70 articles each carry the address of the full text and the author's page on the old site. Both become addresses on this site that do not hold what they claim. |
| `apps/web/src/app/blog/[slug]/page.tsx` | the "Read the full post on knowledgegraph.tech" button, and the setting that tells search engines the old page is the real copy of the article. Both stop meaning anything once there is no old page. |
| `apps/web/src/lib/auth-cors.ts` | only if the attendee app ever moves onto this domain. Not needed for this step. |

Two values are set in the Netlify web interface rather than in a file, on both
the website site and the dashboard site: `WEB_PUBLIC_ORIGIN`, set to the same
`https://www.knowledgegraph.tech`. The value in the file is used while the site
is being built, the value in the interface is used while it is running, and both
have to agree.

One value is set in the attendee app's own configuration:
`EXPO_PUBLIC_SITE_ORIGIN`, currently the Netlify address.

Everything else in both applications reads the address through one shared
function, so there is no hunt. Ninety-odd places across the dashboard, the
emails and the ticket links all follow from the two settings above.

*Verify:*

1. `/previous-events` links go somewhere real, not back to themselves.
2. A blog article's "read the full post" button goes somewhere real.
3. Paste `https://www.knowledgegraph.tech/` into LinkedIn's post box and check
   the preview card shows the right title and picture.
4. Buy a test ticket. The confirmation link in the email must be on
   `www.knowledgegraph.tech`.
5. In the organizer dashboard, open Ticket Marketing. The links it offers for
   sharing must be on the new domain.

*Roll back:* promote the previous deploy. DNS stays where it is.

### Step 6. Tell Stripe and Google

**Stripe.** The webhook endpoint registered in the Stripe dashboard points at
the site's old address. Stripe will keep posting there. Add an endpoint at
`https://www.knowledgegraph.tech/api/stripe/webhook`, copy the signing secret it
gives you, put that secret into both Netlify sites as
`STRIPE_WEBHOOK_SECRET`, and only then remove the old endpoint. Run the two in
parallel for a day.

*Verify:* buy a test ticket and confirm the order appears in the dashboard.
Stripe's own webhook log shows a 200 against the new endpoint.

**Google Search Console.** Add `https://www.knowledgegraph.tech` as a property
if it is not already one, and submit the new sitemap. Then watch the coverage
report for four weeks. What you are looking for is the redirect count rising and
the "not found" count staying near zero. If a batch of "not found" appears, the
addresses listed are the ones the map missed, and they can be added to
`apps/web/public/_redirects` one at a time.

### Step 7. Four weeks later

Only after Search Console has been quiet for a month:

- raise the DNS TTLs back to an hour
- take a full export of the WordPress site and keep it
- switch off the server at `142.93.180.72`

---

## What we need from the owner, or from François

Four things, in the order they block work.

**1. Access to DigitalOcean DNS, or someone who has it.** Two records change.
Nobody on this side can make that change, and nobody should. If François holds
the account, the two rows in step 4 are the entire ask.

**2. Access to the Netlify team that owns the site.** The custom domain is added
there, and the runtime `WEB_PUBLIC_ORIGIN` is set there. The live sites are the
`kgc27-` set on the `mattodoos` team.

**3. Resend.** The site can currently send email to one address only, because
the sending domain has never been verified and Resend refuses everything else.
This is the single thing standing between the site and sending a ticket
confirmation to a real buyer. It needs:

- a Resend account with `knowledgegraph.tech` added as a sending domain
- the three DNS records Resend then asks for, added at DigitalOcean
- the API key, so it can be set on both Netlify sites and on Cloud Functions

Ask Resend for the **subdomain** setup, which puts its records on
`send.knowledgegraph.tech` and leaves the root SPF record alone. The root SPF
ends in `-all` and is shared with Google Workspace and HubSpot. Editing it is a
way to break company email while trying to fix conference email. The subdomain
setup avoids the question entirely.

This is independent of the domain move. It can be done before, during or after.

**4. Stripe.** Two separate things.

- The webhook signing secret is still missing, which means a buyer can reach
  Stripe's payment page but the order never completes on this side. Whoever holds
  the Stripe account creates the endpoint in step 6 and passes back the secret.
- The keys in use are test keys. Moving to live keys is a decision about taking
  real money and is not part of this move.

Nothing else is needed. The certificate, the `www` redirect and the redirect map
are all handled by the platform or by the repository.

---

## Where the redirect map lives and how to change it

`apps/web/public/_redirects`. One rule per line: old address, new address, and
`301`, which is the permanent kind of redirect and the kind that passes a page's
search standing to its replacement.

Rules are read top to bottom and the first match wins, so exact addresses come
first and the catch-alls for whole sections come last. A trailing slash is
ignored when matching.

There is deliberately no rule catching everything. Two reasons. An address the
file does not name falls through to the site itself, which is what lets an
organizer publish a page at a new address without anyone editing this file. And
`/api/stripe/webhook` must never be redirected.

To add a rule, copy the shape of the line above it and put it before the
catch-alls.
