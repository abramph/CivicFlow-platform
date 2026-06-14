export function formatCurrency(value: unknown, currency = "USD") {
  const amount =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number(value ?? 0);

  const safeAmount = Number.isFinite(amount) ? amount : 0;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: Date | string | null | undefined, fallback = "Not recorded") {
  const date = toDate(value);
  if (!date) return fallback;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined, fallback = "Not recorded") {
  const date = toDate(value);
  if (!date) return fallback;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatEnumLabel(value: string | null | undefined, fallback = "Not set") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;

  return text
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatPersonName(person: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
}) {
  const first = String(person.preferredName ?? "").trim() || String(person.firstName).trim();
  const last = String(person.lastName).trim();
  return [first, last].filter(Boolean).join(" ");
}

export function formatDateInputValue(value: Date | string | null | undefined) {
  const date = toDate(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function formatDateTimeLocalInputValue(value: Date | string | null | undefined) {
  const date = toDate(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function formatText(value: string | null | undefined, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}
