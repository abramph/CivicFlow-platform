import type { MembershipStatus, Prisma } from "@prisma/client";

export const memberSortOptions = [
  { value: "lastName", label: "Last name" },
  { value: "firstName", label: "First name" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zipCode", label: "ZIP code" },
  { value: "county", label: "County" },
  { value: "age", label: "Age" },
  { value: "joinDate", label: "Join date" },
  { value: "membershipStatus", label: "Membership status" },
  { value: "membershipCategory", label: "Membership category" },
  { value: "createdAt", label: "Created at" },
] as const;

export type MemberSortOption = (typeof memberSortOptions)[number]["value"];
export type MemberSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

export type ParsedMemberFilters = {
  search: string;
  membershipStatus: string;
  membershipCategoryId: string;
  duesCategoryId: string;
  city: string;
  state: string;
  zipCode: string;
  county: string;
  country: string;
  gender: string;
  ageMin: string;
  ageMax: string;
  dobStart: string;
  dobEnd: string;
  joinStart: string;
  joinEnd: string;
  hasEmail: string;
  hasPhone: string;
  hasOutstandingDues: string;
  delinquency: string;
  sort: string;
};

export const memberExportInclude = {
  membershipCategory: { select: { id: true, name: true } },
  duesCharges: {
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    select: { amountDue: true, amountPaid: true, adjustments: { select: { amount: true } } },
  },
} satisfies Prisma.OrgMemberInclude;

export type MemberExportRow = Prisma.OrgMemberGetPayload<{ include: typeof memberExportInclude }>;

export function getMemberParam(params: MemberSearchParams, key: keyof ParsedMemberFilters, fallback = "") {
  if (params instanceof URLSearchParams) return params.get(key) ?? fallback;
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function parseMemberFilters(params: MemberSearchParams): ParsedMemberFilters {
  return {
    search: getMemberParam(params, "search").trim(),
    membershipStatus: getMemberParam(params, "membershipStatus").trim(),
    membershipCategoryId: getMemberParam(params, "membershipCategoryId").trim(),
    duesCategoryId: getMemberParam(params, "duesCategoryId").trim(),
    city: getMemberParam(params, "city").trim(),
    state: getMemberParam(params, "state").trim(),
    zipCode: getMemberParam(params, "zipCode").trim(),
    county: getMemberParam(params, "county").trim(),
    country: getMemberParam(params, "country").trim(),
    gender: getMemberParam(params, "gender").trim(),
    ageMin: getMemberParam(params, "ageMin").trim(),
    ageMax: getMemberParam(params, "ageMax").trim(),
    dobStart: getMemberParam(params, "dobStart").trim(),
    dobEnd: getMemberParam(params, "dobEnd").trim(),
    joinStart: getMemberParam(params, "joinStart").trim(),
    joinEnd: getMemberParam(params, "joinEnd").trim(),
    hasEmail: getMemberParam(params, "hasEmail").trim(),
    hasPhone: getMemberParam(params, "hasPhone").trim(),
    hasOutstandingDues: getMemberParam(params, "hasOutstandingDues").trim(),
    delinquency: getMemberParam(params, "delinquency").trim(),
    sort: getMemberParam(params, "sort", "lastName").trim() || "lastName",
  };
}

export function buildMemberOrderBy(sort: string): Prisma.OrgMemberOrderByWithRelationInput[] {
  const resolvedSort = memberSortOptions.some((option) => option.value === sort)
    ? (sort as MemberSortOption)
    : "lastName";

  switch (resolvedSort) {
    case "firstName":
      return [{ firstName: "asc" }, { lastName: "asc" }];
    case "city":
      return [{ city: "asc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "state":
      return [{ state: "asc" }, { city: "asc" }, { lastName: "asc" }];
    case "zipCode":
      return [{ zipCode: "asc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "county":
      return [{ county: "asc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "age":
      return [{ dateOfBirth: "asc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "joinDate":
      return [{ joinDate: "desc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "membershipStatus":
      return [{ membershipStatus: "asc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "membershipCategory":
      return [{ membershipCategory: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }];
    case "createdAt":
      return [{ createdAt: "desc" }, { lastName: "asc" }, { firstName: "asc" }];
    case "lastName":
    default:
      return [{ lastName: "asc" }, { firstName: "asc" }];
  }
}

export function buildMemberWhere(organizationId: string, filters: ParsedMemberFilters): Prisma.OrgMemberWhereInput {
  const validStatuses: MembershipStatus[] = ["active", "inactive", "deactivated", "pending", "retired", "suspended", "terminated"];
  const validMembershipStatus = validStatuses.includes(filters.membershipStatus as MembershipStatus)
    ? (filters.membershipStatus as MembershipStatus)
    : null;

  const today = new Date();
  const dobRange: Prisma.DateTimeNullableFilter = {};
  if (filters.ageMin && !Number.isNaN(Number(filters.ageMin))) {
    dobRange.lte = new Date(today.getFullYear() - Number(filters.ageMin), today.getMonth(), today.getDate());
  }
  if (filters.ageMax && !Number.isNaN(Number(filters.ageMax))) {
    dobRange.gte = new Date(today.getFullYear() - Number(filters.ageMax) - 1, today.getMonth(), today.getDate() + 1);
  }
  if (filters.dobStart) dobRange.gte = new Date(`${filters.dobStart}T00:00:00.000Z`);
  if (filters.dobEnd) dobRange.lte = new Date(`${filters.dobEnd}T23:59:59.999Z`);

  const joinDateRange: Prisma.DateTimeNullableFilter = {};
  if (filters.joinStart) joinDateRange.gte = new Date(`${filters.joinStart}T00:00:00.000Z`);
  if (filters.joinEnd) joinDateRange.lte = new Date(`${filters.joinEnd}T23:59:59.999Z`);

  return {
    organizationId,
    ...(filters.search
      ? {
          OR: [
            { firstName: { contains: filters.search, mode: "insensitive" } },
            { lastName: { contains: filters.search, mode: "insensitive" } },
            { preferredName: { contains: filters.search, mode: "insensitive" } },
            { email: { contains: filters.search, mode: "insensitive" } },
            { phone: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(validMembershipStatus ? { membershipStatus: validMembershipStatus } : {}),
    ...(filters.membershipCategoryId ? { membershipCategoryId: filters.membershipCategoryId } : {}),
    ...(filters.city ? { city: { contains: filters.city, mode: "insensitive" } } : {}),
    ...(filters.state ? { state: { contains: filters.state, mode: "insensitive" } } : {}),
    ...(filters.zipCode ? { zipCode: { contains: filters.zipCode, mode: "insensitive" } } : {}),
    ...(filters.county ? { county: { contains: filters.county, mode: "insensitive" } } : {}),
    ...(filters.country ? { country: { contains: filters.country, mode: "insensitive" } } : {}),
    ...(filters.gender ? { gender: { contains: filters.gender, mode: "insensitive" } } : {}),
    ...(filters.duesCategoryId ? { membershipCategory: { standardDuesCategoryId: filters.duesCategoryId } } : {}),
    ...(Object.keys(dobRange).length ? { dateOfBirth: dobRange } : {}),
    ...(Object.keys(joinDateRange).length ? { joinDate: joinDateRange } : {}),
    ...(filters.hasEmail === "yes" ? { email: { not: null } } : filters.hasEmail === "no" ? { email: null } : {}),
    ...(filters.hasPhone === "yes" ? { phone: { not: null } } : filters.hasPhone === "no" ? { phone: null } : {}),
    ...(filters.hasOutstandingDues === "yes" ? { duesCharges: { some: { status: { in: ["PENDING", "PARTIAL"] } } } } : {}),
    ...(filters.delinquency === "delinquent" ? { isDelinquent: true } : filters.delinquency === "not-delinquent" ? { isDelinquent: false } : {}),
  };
}

export function buildMemberFilterQuery(params: MemberSearchParams, extra: Record<string, string> = {}) {
  const output = new URLSearchParams();
  const filters = parseMemberFilters(params);
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "sort" && value === "lastName")) output.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) output.set(key, value);
  return output.toString();
}

export function hasActiveMemberFilters(filters: ParsedMemberFilters) {
  return Boolean(
    filters.search ||
      filters.membershipStatus ||
      filters.membershipCategoryId ||
      filters.city ||
      filters.state ||
      filters.zipCode ||
      filters.county ||
      filters.country ||
      filters.gender ||
      filters.duesCategoryId ||
      filters.ageMin ||
      filters.ageMax ||
      filters.dobStart ||
      filters.dobEnd ||
      filters.joinStart ||
      filters.joinEnd ||
      filters.hasEmail ||
      filters.hasPhone ||
      filters.hasOutstandingDues ||
      filters.delinquency ||
      filters.sort !== "lastName"
  );
}

export function calculateAge(dateOfBirth: Date | null | undefined, asOfDate = new Date()) {
  if (!dateOfBirth) return "";
  let age = asOfDate.getFullYear() - dateOfBirth.getFullYear();
  const monthDelta = asOfDate.getMonth() - dateOfBirth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOfDate.getDate() < dateOfBirth.getDate())) age -= 1;
  return age;
}

export function calculateMemberOutstandingDues(member: Pick<MemberExportRow, "duesCharges">) {
  return member.duesCharges.reduce((sum, charge) => {
    const adjustments = charge.adjustments.reduce((adjustmentSum, adjustment) => adjustmentSum + Number(adjustment.amount), 0);
    return sum + Math.max(0, Number(charge.amountDue) - Number(charge.amountPaid) - adjustments);
  }, 0);
}

export function describeMemberFilters(filters: ParsedMemberFilters) {
  const entries = Object.entries(filters).filter(([key, value]) => value && !(key === "sort" && value === "lastName"));
  if (entries.length === 0) return "No filters applied";
  return entries.map(([key, value]) => `${key}: ${value}`).join("; ");
}
