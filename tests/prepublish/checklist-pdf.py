"""Builds PREPUBLISH-CHECKLIST.pdf at the repo root.

Needs reportlab: python3 -m venv .venv && .venv/bin/pip install reportlab
Run: .venv/bin/python tests/prepublish/checklist-pdf.py
Keep the items in step with the specs and PREPUBLISH-TESTS.md.
"""
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, Flowable, KeepTogether)
from reportlab.lib.styles import ParagraphStyle

OUT = str(Path(__file__).resolve().parents[2] / "PREPUBLISH-CHECKLIST.pdf")
GREY = HexColor("#777777")
RULE = HexColor("#d6d6d6")

title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=20, leading=24)
sub = ParagraphStyle("s", fontName="Helvetica", fontSize=9.5, leading=13, textColor=GREY)
h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceBefore=16, spaceAfter=4)
note = ParagraphStyle("n", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=GREY, spaceAfter=4)
item = ParagraphStyle("i", fontName="Helvetica", fontSize=9.5, leading=13)


class Box(Flowable):
    def __init__(self, size=8):
        super().__init__()
        self.size = size
        self.width = self.height = size

    def draw(self):
        self.canv.setStrokeColor(black)
        self.canv.setLineWidth(0.6)
        self.canv.rect(0, 0.5, self.size, self.size)


def section(name, items, lead=None):
    def table(rows, last):
        t = Table(rows, colWidths=[0.28 * inch, 6.2 * inch])
        style = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 3.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ]
        style.append(("LINEBELOW", (0, 0), (-1, -2 if last else -1), 0.4, RULE))
        t.setStyle(TableStyle(style))
        return t

    rows = [[Box(), Paragraph(t, item)] for t in items]
    head = [Paragraph(name, h)]
    if lead:
        head.append(Paragraph(lead, note))
    out = [KeepTogether(head + [table(rows[:2], len(rows) <= 2)])]
    if len(rows) > 2:
        out.append(table(rows[2:], True))
    return out


story = [
    Paragraph("Website pre-publish checklist", title),
    Spacer(1, 4),
    Paragraph("KGC 2027 &nbsp;/&nbsp; apps/web &nbsp;/&nbsp; September 2026", sub),
    Spacer(1, 10),
    Paragraph(
        "Run <font name='Courier'>npm run publish:web</font>. It deploys to staging at "
        "staging.knowledgegraph.tech and runs these checks against it. "
        "Everything below is automatic except the last section.", item),
]

story += section("Before deploying", [
    "Your latest commit is pushed to GitHub",
    "No other deploy running on the server",
    "Web app typechecks",
    "Unit tests pass",
    "Staging is running the commit you pushed",
])

story += section("Tickets page", [
    "Opens on the tickets, first price visible without scrolling",
    "Dates and venue under the heading",
    "At least one ticket on sale",
    "Every ticket has a name and a real price",
    "Most expensive ticket is the big panel",
    "Sold out or closed tickets say why",
    "Every Choose button opens checkout with that ticket picked",
    "FAQ answers open",
    "Invoice link and contact email work",
    "Cancelled payment message shows",
])

story += section("Checkout", [
    "Right ticket name and price for every tier",
    "Order summary, total and pay button all show the same amount",
    "Change and All tickets go back",
    "Unknown ticket in the link shows a picker instead",
    "Quantity goes 1 to 10",
    "Each extra ticket adds an attendee card",
    "Total updates with quantity",
    "Mixed tickets add up correctly",
    "Typed names survive changing the quantity",
    "Every field has a label, name and email are required",
    "No price or card fields on the page",
    "Code of conduct and privacy links work",
    "Can be filled in with the keyboard only",
    "Fits a phone with three attendees, pay button easy to tap",
    "Demo skip payment button never shows on the real site",
])

story += section("Sales state", [
    "Closed: pay button is greyed out",
    "Closed: notice with an Email us link",
    "Open: pay button works",
    "Setting matches reality (PREPUBLISH_SALES)",
], lead="Flip PREPUBLISH_SALES to open in scripts/publish-web.sh when Stripe goes live.")

story += section("When sales are open", [
    "Blank name refused",
    "Bad email refused, typing kept",
    "Same email twice refused",
    "Extra attendee with no name refused",
    "Made up ticket type refused",
    "Stripe page shows the right ticket, amount and email",
    "Optional: test card purchase lands on the order page",
])

story += section("Invoice, sponsor and exhibitor", [
    "Invoice page says closed and offers email, or shows the form",
    "Invoice attendees add and remove, subtotal follows, max ten",
    "Invoice refuses missing company, bad billing email, duplicates",
    "Sponsor and exhibitor packages show prices or say not published",
    "Choosing a package fills the form below",
])

story += section("Security", [
    "Fake Stripe payment notification refused",
    "Return page with a fake session gives no ticket",
    "Fake links to order, speaker, reviewer and exhibitor pages return not found",
    "Exhibitor leads download never leaks a spreadsheet",
    "Local-only sign-in code reader is off",
    "HTTPS headers present",
    "No keys or passwords in the page code",
])

story += section("Penetration testing", [
    "Private files not served: .env, .git, package.json, config files",
    "Path traversal refused",
    "Source maps not published, folders don't list their files",
    "Script in search, links or the checkout form never runs",
    "Injection attempts and very long input don't break search or checkout",
    "Forged server action refused, no stack trace",
    "Error pages don't show code or file paths",
    "Unusual HTTP methods handled, TRACE doesn't echo",
    "Sign-in endpoints reject requests from other websites",
    "Guessed or malformed sign-in codes refused, no token returned",
    "No redirects to outside websites",
    "HTTP upgrades to HTTPS",
    "Purchase pages can't be embedded in another site",
    "Server doesn't advertise what it runs on",
    "Cookies are Secure",
], lead="Safe to run on the live site. No data written, no emails, no load testing.")

story += section("Every page, desktop and phone", [
    "Loads in under 8 seconds",
    "Has a title, a main heading and a description",
    "Header and footer present",
    "No undefined, NaN, TODO or placeholder text",
    "No old or local web addresses",
    "All images load and have alt text",
    "No console errors or failed requests",
    "No sideways scrolling on a phone",
    "404 page works",
])

story += section("Navigation and sharing", [
    "Header and footer links work",
    "Phone menu opens and closes",
    "Search finds results",
    "No broken links anywhere on the site",
    "Accessibility scan passes",
    "Link previews have a title, description and working image",
    "Page titles are all different",
])

story += section("By hand, before the first real sale", [
    "Buy one ticket on staging with the Stripe test card",
    "Receipt email arrives",
    "Sign into the app with that email and see the badge",
    "Order shows on the dashboard with the right amount",
    "Refund it from the dashboard",
    "Promo code gives a discount",
    "Tax shows for a New York address",
], lead="These can't be automated yet.")

story += [Spacer(1, 18), Paragraph(
    "Last full run: staging, 25 September 2026, commit 59a31d0. All automatic "
    "checks passed; the sales-open checks were skipped because Stripe is not set up.", note)]


def footer(c, d):
    c.setFont("Helvetica", 8)
    c.setFillColor(GREY)
    c.drawRightString(letter[0] - 0.9 * inch, 0.55 * inch, str(d.page))


SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                  topMargin=0.85 * inch, bottomMargin=0.85 * inch,
                  title="Website pre-publish checklist", author="KGC").build(
    story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
