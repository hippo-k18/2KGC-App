import { describe, expect, it } from "vitest";

import {
  LEARN_EMBED_PROVIDERS,
  SHORT_MAPS_LINK_MESSAGE,
  defaultEmbedTitle,
  isLearnEmbedProvider,
  learnEmbedLinkProblem,
  learnEmbedSrc,
} from "./learn-embed-core.js";

const YT = "dQw4w9WgXcQ";
const LOOM = "0281766fa2d04bb788eaf19e65135184";
const SPOT = "4uLU6hMCjMI75M1A2tKUQC";
const GID = "2PACX-1vTabcdefghijklmnopqrstuvwxyz0123456789";
const PB = "!1m18!1m12!1m3!1d3022.2!2d-73.98!3d40.75!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c259:0x2b!2sJay Conference Bryant Park!5e0!3m2!1sen!2sus!4v1700000000000";

/** Each provider: accepted inputs with the src they give, and inputs refused. */
const CASES: Record<string, { ok: [string, string][]; bad: string[] }> = {
  youtube: {
    ok: [
      [`https://www.youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
      [`https://youtube.com/watch?v=${YT}&list=x&t=90s`, `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
      [`https://m.youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
      [`https://youtu.be/${YT}?t=42`, `https://www.youtube-nocookie.com/embed/${YT}?start=42`],
      [`https://youtu.be/${YT}?t=1m30s`, `https://www.youtube-nocookie.com/embed/${YT}`],
      [`https://www.youtube.com/embed/${YT}?start=5`, `https://www.youtube-nocookie.com/embed/${YT}?start=5`],
      [`https://www.youtube.com/shorts/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
      [`https://www.youtube.com/live/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
      [`https://www.youtube-nocookie.com/embed/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
      [`  https://youtu.be/${YT}  `, `https://www.youtube-nocookie.com/embed/${YT}`],
    ],
    bad: [
      `http://www.youtube.com/watch?v=${YT}`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/watch?v=${YT}x`,
      `https://www.youtube.com/channel/${YT}`,
      `https://youtube.com.evil.example/watch?v=${YT}`,
      `https://evil.example/youtube.com/watch?v=${YT}`,
      `https://youtube.com@evil.example/watch?v=${YT}`,
      `https://user:pw@youtube.com/watch?v=${YT}`,
      `https://www.youtube.com:8443/watch?v=${YT}`,
      `https://evil.example\\@youtube.com/watch?v=${YT}`,
      `//www.youtube.com/watch?v=${YT}`,
      `javascript:alert(1)//https://youtu.be/${YT}`,
      `https://youtu.be/${YT}/extra`,
      `https://www.youtube-nocookie.com/watch?v=${YT}`,
      `https://www.youtube.com/embed//${YT}`,
      `https://vimeo.com/76979871`,
      `https://www.youtube.com/watch?v=${YT} x`,
    ],
  },
  vimeo: {
    ok: [
      ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"],
      ["https://www.vimeo.com/76979871/abc123def0", "https://player.vimeo.com/video/76979871?h=abc123def0"],
      ["https://player.vimeo.com/video/76979871", "https://player.vimeo.com/video/76979871"],
      ["https://player.vimeo.com/video/76979871?h=abc123def0&badge=0", "https://player.vimeo.com/video/76979871?h=abc123def0"],
    ],
    bad: [
      "http://vimeo.com/76979871",
      "https://vimeo.com/channels/staffpicks",
      "https://player.vimeo.com/video/76979871?h=<script>",
      "https://vimeo.com.evil.example/76979871",
      "https://evil.example/vimeo.com/76979871",
      `https://youtu.be/${YT}`,
    ],
  },
  "google-maps": {
    ok: [
      [`https://www.google.com/maps/embed?pb=${encodeURIComponent(PB)}`, `https://www.google.com/maps/embed?pb=${encodeURIComponent(PB)}`],
      // T325: the links people copy from the address bar, rebuilt into the keyless embed form.
      [
        "https://www.google.com/maps/place/Bryant+Park/@40.7535965,-73.9832326,17z/data=!3m1!4b1!4m6!3m5!1s0x89c259",
        "https://www.google.com/maps?q=Bryant%20Park&z=17&output=embed",
      ],
      ["https://www.google.com/maps/place/Bryant+Park", "https://www.google.com/maps?q=Bryant%20Park&output=embed"],
      [
        "https://www.google.com/maps/place/Caf%C3%A9+de+Flore,+172+Bd+Saint-Germain/@48.854,2.332,15.5z",
        "https://www.google.com/maps?q=Caf%C3%A9%20de%20Flore%2C%20172%20Bd%20Saint-Germain&z=16&output=embed",
      ],
      ["https://www.google.com/maps/@40.75,-73.98,17z", "https://www.google.com/maps?q=40.75%2C-73.98&z=17&output=embed"],
      ["https://google.com/maps/@40.75,-73.98,3a,75y,90t", "https://www.google.com/maps?q=40.75%2C-73.98&output=embed"],
      ["https://www.google.com/maps/search/coffee+near+bryant+park/@40.75,-73.98,15z", "https://www.google.com/maps?q=coffee%20near%20bryant%20park&z=15&output=embed"],
      ["https://www.google.com/maps/search/?api=1&query=Bryant+Park", "https://www.google.com/maps?q=Bryant%20Park&output=embed"],
      ["https://maps.google.com/maps?q=Bryant+Park", "https://www.google.com/maps?q=Bryant%20Park&output=embed"],
      ["https://www.google.com/maps?q=100%25+Coffee", "https://www.google.com/maps?q=100%25%20Coffee&output=embed"],
      [
        "https://www.google.com/maps?q=Bryant+Park%22%3E%3Cscript%3E&output=embed",
        "https://www.google.com/maps?q=Bryant%20Park%22%3E%3Cscript%3E&output=embed",
      ],
    ],
    bad: [
      "https://maps.app.goo.gl/abc",
      "https://goo.gl/maps/abc",
      "https://www.google.com/maps",
      "https://www.google.com/maps/dir/Grand+Central/Bryant+Park",
      "https://www.google.com/maps/embed/v1/place?key=x&q=Bryant+Park",
      "https://www.google.com/maps/@91,-73.98,17z",
      "https://www.google.com/maps/@40.75,-181,17z",
      `https://www.google.com/maps/place/${"x".repeat(201)}`,
      "https://www.google.com/maps/place/%E0%A4%A",
      "https://www.google.com/search?q=Bryant+Park",
      "https://www.google.com.evil.example/maps/place/Bryant+Park",
      "https://www.google.com/maps/embed",
      "https://www.google.com/maps/embed?pb=%3Cscript%3E",
      "https://www.google.com.evil.example/maps/embed?pb=!1m1",
      "http://www.google.com/maps/embed?pb=!1m1",
    ],
  },
  "google-forms": {
    ok: [
      [`https://docs.google.com/forms/d/e/${GID}/viewform`, `https://docs.google.com/forms/d/e/${GID}/viewform?embedded=true`],
      [`https://docs.google.com/forms/d/e/${GID}/viewform?usp=sf_link`, `https://docs.google.com/forms/d/e/${GID}/viewform?embedded=true`],
      [`https://docs.google.com/forms/d/e/${GID}/viewform?embedded=true`, `https://docs.google.com/forms/d/e/${GID}/viewform?embedded=true`],
      [`https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/viewform`, `https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/viewform?embedded=true`],
    ],
    bad: [
      "https://forms.gle/abcdEFGH",
      `https://docs.google.com/forms/d/${GID}/edit`,
      `https://docs.google.com/document/d/e/${GID}/pub`,
      `https://docs.google.com.evil.example/forms/d/e/${GID}/viewform`,
    ],
  },
  "google-docs": {
    ok: [
      [`https://docs.google.com/document/d/e/${GID}/pub`, `https://docs.google.com/document/d/e/${GID}/pub?embedded=true`],
      [`https://docs.google.com/document/d/e/${GID}/pub?embedded=true`, `https://docs.google.com/document/d/e/${GID}/pub?embedded=true`],
    ],
    bad: [
      `https://docs.google.com/document/d/${GID}/edit`,
      `https://docs.google.com/document/d/${GID}/preview`,
      `https://docs.google.com/presentation/d/e/${GID}/pub`,
      `http://docs.google.com/document/d/e/${GID}/pub`,
    ],
  },
  "google-slides": {
    ok: [
      [`https://docs.google.com/presentation/d/e/${GID}/embed?start=false`, `https://docs.google.com/presentation/d/e/${GID}/embed`],
      [`https://docs.google.com/presentation/d/e/${GID}/pub`, `https://docs.google.com/presentation/d/e/${GID}/embed`],
    ],
    bad: [
      `https://docs.google.com/presentation/d/${GID}/edit`,
      `https://docs.google.com/document/d/e/${GID}/pub`,
      `https://slides.google.com/presentation/d/e/${GID}/embed`,
    ],
  },
  calendly: {
    ok: [
      ["https://calendly.com/kgc-learn", "https://calendly.com/kgc-learn"],
      ["https://calendly.com/kgc-learn/30min?month=2026-10", "https://calendly.com/kgc-learn/30min"],
      ["https://www.calendly.com/kgc-learn/30min/", "https://calendly.com/kgc-learn/30min"],
    ],
    bad: [
      "https://calendly.com/",
      "https://calendly.com/a/b/c",
      "https://calendly.com.evil.example/kgc",
      "https://evil.example/calendly.com/kgc",
      "http://calendly.com/kgc",
    ],
  },
  typeform: {
    ok: [
      ["https://form.typeform.com/to/AbC123xY", "https://form.typeform.com/to/AbC123xY"],
      ["https://kgc.typeform.com/to/AbC123xY?typeform-source=x", "https://kgc.typeform.com/to/AbC123xY"],
    ],
    bad: [
      "https://typeform.com/to/AbC123xY",
      "https://a.b.typeform.com/to/AbC123xY",
      "https://kgc.typeform.com.evil.example/to/AbC123xY",
      "https://kgc.typeform.com/forms/AbC123xY",
      "https://-bad.typeform.com/to/AbC123xY",
    ],
  },
  loom: {
    ok: [
      [`https://www.loom.com/share/${LOOM}`, `https://www.loom.com/embed/${LOOM}`],
      [`https://loom.com/embed/${LOOM}?sid=1`, `https://www.loom.com/embed/${LOOM}`],
      [`https://www.loom.com/share/Course-intro-${LOOM}`, `https://www.loom.com/embed/${LOOM}`],
    ],
    bad: [`https://www.loom.com/share/${LOOM.slice(1)}`, `https://www.loom.com/looms/${LOOM}`, `https://loom.com.evil.example/share/${LOOM}`],
  },
  spotify: {
    ok: [
      [`https://open.spotify.com/track/${SPOT}?si=abc`, `https://open.spotify.com/embed/track/${SPOT}`],
      [`https://open.spotify.com/embed/playlist/${SPOT}`, `https://open.spotify.com/embed/playlist/${SPOT}`],
      [`https://open.spotify.com/intl-de/episode/${SPOT}`, `https://open.spotify.com/embed/episode/${SPOT}`],
      [`https://open.spotify.com/show/${SPOT}`, `https://open.spotify.com/embed/show/${SPOT}`],
      [`https://open.spotify.com/album/${SPOT}`, `https://open.spotify.com/embed/album/${SPOT}`],
    ],
    bad: [
      `https://open.spotify.com/user/${SPOT}`,
      `https://spotify.com/track/${SPOT}`,
      `https://open.spotify.com/track/${SPOT}x`,
      `spotify:track:${SPOT}`,
    ],
  },
};

describe("learnEmbedSrc", () => {
  it("covers every provider", () => {
    expect(Object.keys(CASES).sort()).toEqual([...LEARN_EMBED_PROVIDERS].sort());
  });

  for (const [provider, { ok, bad }] of Object.entries(CASES)) {
    it(`${provider}: accepts the share and embed forms and gives the embed src`, () => {
      for (const [input, src] of ok) expect(learnEmbedSrc(provider, input), input).toBe(src);
    });
    it(`${provider}: refuses other hosts, schemes and forms`, () => {
      for (const input of bad) expect(learnEmbedSrc(provider, input), input).toBeNull();
    });
  }

  it("refuses a URL that belongs to a different provider", () => {
    expect(learnEmbedSrc("vimeo", `https://youtu.be/${YT}`)).toBeNull();
    expect(learnEmbedSrc("google-docs", `https://docs.google.com/forms/d/e/${GID}/viewform`)).toBeNull();
    expect(learnEmbedSrc("loom", `https://open.spotify.com/track/${SPOT}`)).toBeNull();
  });

  it("refuses an unknown provider and non-text input", () => {
    expect(learnEmbedSrc("iframe", `https://youtu.be/${YT}`)).toBeNull();
    expect(learnEmbedSrc("youtube", 42 as unknown as string)).toBeNull();
    expect(learnEmbedSrc("youtube", `https://youtu.be/${YT}?x=${"a".repeat(2_000)}`)).toBeNull();
    expect(isLearnEmbedProvider("youtube")).toBe(true);
    expect(isLearnEmbedProvider("YouTube")).toBe(false);
  });

  it("always gives an https src on the provider's own host", () => {
    for (const [provider, { ok }] of Object.entries(CASES)) {
      for (const [input] of ok) {
        const src = learnEmbedSrc(provider, input)!;
        expect(new URL(src).protocol).toBe("https:");
        expect(src.startsWith("https://")).toBe(true);
      }
    }
  });
});

describe("learnEmbedLinkProblem (T325)", () => {
  it("has nothing to say about a link that works or an empty one", () => {
    expect(learnEmbedLinkProblem("google-maps", "https://www.google.com/maps/place/Bryant+Park/@40.75,-73.98,17z")).toBeNull();
    expect(learnEmbedLinkProblem("youtube", `https://youtu.be/${YT}`)).toBeNull();
    expect(learnEmbedLinkProblem("google-maps", "  ")).toBeNull();
  });

  it("says plainly why a short Google Maps link cannot be shown", () => {
    expect(learnEmbedLinkProblem("google-maps", "https://maps.app.goo.gl/AbCdEf123")).toBe(SHORT_MAPS_LINK_MESSAGE);
    expect(learnEmbedLinkProblem("google-maps", "https://goo.gl/maps/AbCdEf123")).toBe(SHORT_MAPS_LINK_MESSAGE);
    expect(SHORT_MAPS_LINK_MESSAGE).toBe(
      "Short Google Maps links can't be shown. Open the link, then copy the address from the browser's address bar.",
    );
  });

  it("names half-typed addresses, http, directions, unpublished docs and other services", () => {
    expect(learnEmbedLinkProblem("google-maps", "www.google.com/maps/place/x")).toMatch(/^That is not a full web address yet\. Paste the whole Google Maps link/);
    expect(learnEmbedLinkProblem("youtube", "https:/")).toMatch(/^That is not a full web address yet/);
    expect(learnEmbedLinkProblem("youtube", `http://youtu.be/${YT}`)).toBe("The link must start with https://.");
    expect(learnEmbedLinkProblem("google-maps", "https://www.google.com/maps/dir/A/B")).toMatch(/^Directions can't be shown\./);
    expect(learnEmbedLinkProblem("google-docs", `https://docs.google.com/document/d/${GID}/edit`)).toMatch(/^Only published files can be shown\./);
    expect(learnEmbedLinkProblem("google-forms", "https://forms.gle/abc")).toMatch(/^Short Google Forms links can't be shown\./);
    expect(learnEmbedLinkProblem("vimeo", `https://youtu.be/${YT}`)).toBe("That is not a Vimeo link this page can show.");
  });

  it("never says a link is fine when learnEmbedSrc would refuse it", () => {
    for (const [provider, { ok, bad }] of Object.entries(CASES)) {
      for (const [input] of ok) expect(learnEmbedLinkProblem(provider, input), input).toBeNull();
      for (const input of bad) expect(learnEmbedLinkProblem(provider, input), input).not.toBeNull();
    }
  });
});

describe("defaultEmbedTitle (T325)", () => {
  it("follows the service", () => {
    expect(defaultEmbedTitle("google-maps")).toBe("Map");
    expect(defaultEmbedTitle("youtube")).toBe("Video");
    expect(defaultEmbedTitle("google-forms")).toBe("Form");
    expect(defaultEmbedTitle("calendly")).toBe("Calendar");
    expect(defaultEmbedTitle("nope")).toBe("Embedded content");
    for (const p of LEARN_EMBED_PROVIDERS) expect(defaultEmbedTitle(p).length).toBeGreaterThan(0);
  });
});
