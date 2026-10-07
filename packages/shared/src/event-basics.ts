import { EVENT } from "./event.js";

/**
 * The event's editable identity: what Content > Basics saves, resolved over the
 * constants in `event.ts`.
 *
 * `EVENT` stays the fallback, so a surface that has not fetched the settings
 * document yet, or an event that has never saved one, shows what it showed
 * before. Pure: each install reads `settings/event` its own way and hands the
 * values to `resolveEventBasics`.
 */

export type EventType = "in-person" | "virtual" | "hybrid";

export const EVENT_TYPES: readonly EventType[] = ["in-person", "virtual", "hybrid"];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  "in-person": "In-person event",
  virtual: "Virtual event",
  hybrid: "Hybrid event",
};

/** What `settings/event` stores. An empty string means "use the constant". */
export interface EventSettings {
  name: string;
  shortName: string;
  /** `YYYY-MM-DD`, in the event's own zone. */
  startDate: string;
  /** `YYYY-MM-DD`, in the event's own zone. */
  endDate: string;
  /** An IANA zone name, like `America/New_York`. */
  timeZone: string;
  venue: string;
  eventType: string;
}

export const EVENT_SETTINGS_DEFAULTS: EventSettings = {
  name: "",
  shortName: "",
  startDate: "",
  endDate: "",
  timeZone: "",
  venue: "",
  eventType: "",
};

/** The constants every surface used before any of this was editable. */
export const EVENT_BASICS_FALLBACK = {
  name: EVENT.name,
  shortName: EVENT.shortName,
  startDate: "2027-05-03",
  endDate: "2027-05-07",
  timeZone: EVENT.timeZone,
  venue: EVENT.venue,
  eventType: "in-person" as EventType,
};

export interface EventBasics {
  name: string;
  shortName: string;
  startDate: string;
  endDate: string;
  /** False while the dates are the fallback, so a surface with an agenda can prefer its span. */
  datesSaved: boolean;
  timeZone: string;
  venue: string;
  eventType: EventType;
  /** False while `eventType` is the fallback, so a reader can prefer its own evidence. */
  eventTypeSaved: boolean;
  eventTypeLabel: string;
  /** "3–7 May 2027" */
  datesLong: string;
  /** "May 3–7, 2027" */
  datesShort: string;
  year: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a real calendar day written `YYYY-MM-DD`. */
export function isDayKey(value: string): boolean {
  if (!DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whether the runtime knows this IANA zone. */
export function isTimeZone(value: string): boolean {
  if (!value || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A date range the way the site already writes it.
 *
 * `long` is day first ("3–7 May 2027"), `short` is month first
 * ("May 3–7, 2027"). The month and the year are printed once when both ends
 * share them. Built from the day keys rather than from `Date` formatting so the
 * reader's own time zone cannot move a day.
 */
export function formatDateRange(startDate: string, endDate: string, style: "long" | "short"): string {
  if (!isDayKey(startDate)) return "";
  const end = isDayKey(endDate) && endDate >= startDate ? endDate : startDate;
  const [y1, m1, d1] = startDate.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  const mon = (m: number) => (style === "short" ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]);
  const one = (y: number, m: number, d: number, withYear: boolean) =>
    style === "long"
      ? `${d} ${mon(m)}${withYear ? ` ${y}` : ""}`
      : `${mon(m)} ${d}${withYear ? `, ${y}` : ""}`;

  if (startDate === end) return one(y1, m1, d1, true);
  if (y1 === y2 && m1 === m2) {
    return style === "long" ? `${d1}–${d2} ${mon(m1)} ${y1}` : `${mon(m1)} ${d1}–${d2}, ${y1}`;
  }
  return `${one(y1, m1, d1, y1 !== y2)} – ${one(y2, m2, d2, true)}`;
}

/** Stored values over the constants. Anything unset or unusable falls back. */
export function resolveEventBasics(stored: Partial<EventSettings> | undefined | null): EventBasics {
  const s = stored ?? {};
  const f = EVENT_BASICS_FALLBACK;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const startDate = isDayKey(text(s.startDate)) ? text(s.startDate) : f.startDate;
  const storedEnd = isDayKey(text(s.endDate)) ? text(s.endDate) : "";
  /* An end before the start is a half-saved pair, so both come from one source. */
  const endDate =
    storedEnd && storedEnd >= startDate ? storedEnd : startDate === f.startDate ? f.endDate : startDate;
  const eventType = isEventType(text(s.eventType)) ? (text(s.eventType) as EventType) : f.eventType;

  return {
    name: text(s.name) || f.name,
    shortName: text(s.shortName) || f.shortName,
    startDate,
    endDate,
    datesSaved: isDayKey(text(s.startDate)),
    timeZone: isTimeZone(text(s.timeZone)) ? text(s.timeZone) : f.timeZone,
    venue: text(s.venue) || f.venue,
    eventType,
    eventTypeSaved: isEventType(text(s.eventType)),
    eventTypeLabel: EVENT_TYPE_LABEL[eventType],
    datesLong: formatDateRange(startDate, endDate, "long"),
    datesShort: formatDateRange(startDate, endDate, "short"),
    year: Number(startDate.slice(0, 4)),
  };
}

export type EventBasicsErrors = Partial<Record<keyof EventSettings, string>>;

/**
 * Check what the Basics form posted. Every field may be left empty, which
 * clears it back to the constant.
 */
export function validateEventSettings(input: EventSettings): EventBasicsErrors {
  const errors: EventBasicsErrors = {};
  if (input.name.length > 120) errors.name = "Keep the event name under 120 characters.";
  if (input.shortName.length > 20) errors.shortName = "Keep the short name under 20 characters.";
  if (input.venue.length > 200) errors.venue = "Keep the venue under 200 characters.";
  if (input.startDate && !isDayKey(input.startDate)) errors.startDate = "Enter a real date.";
  if (input.endDate && !isDayKey(input.endDate)) errors.endDate = "Enter a real date.";
  if (Boolean(input.startDate) !== Boolean(input.endDate) && !errors.startDate && !errors.endDate) {
    errors[input.startDate ? "endDate" : "startDate"] = "Set both dates, or leave both empty.";
  }
  if (input.startDate && input.endDate && !errors.startDate && !errors.endDate) {
    if (input.endDate < input.startDate) errors.endDate = "The end date is before the start date.";
  }
  if (input.timeZone && !isTimeZone(input.timeZone)) {
    errors.timeZone = "That is not a time zone. Use a name like America/New_York.";
  }
  if (input.eventType && !isEventType(input.eventType)) errors.eventType = "Choose an event type.";
  return errors;
}
