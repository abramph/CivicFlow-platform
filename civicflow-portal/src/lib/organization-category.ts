import type { OrganizationCategory, OrganizationVertical } from "@prisma/client";

/**
 * CORE-GIVE-I (§2/§3) — presentation-layer organization categories.
 * The category NEVER changes which experience engine runs (that is
 * primaryVertical, consumed by the exhaustive nav/terminology maps and the
 * frozen mobile app). It refines presentation WITHIN an experience:
 * category-appropriate labels and giving-terminology presets. Presets are
 * offered, applied only on explicit confirmation, and write ordinary
 * OrgSettings fields — backend concepts never rename (§3).
 */
export interface CategoryInfo {
  label: string;
  description: string;
  /** Which experience engine this category runs on. */
  experienceVertical: OrganizationVertical;
  /** Suggested OrgSettings.contributionTerminology. */
  givingTerminology: string;
  /** Suggested OrgSettings.memberTerminology. */
  memberLabel: string;
  /** What this category calls its groups ("Ministries", "Committees", …).
   * Presentation only — OrgGroup.kindLabel is set per group. */
  groupsLabel: string;
}

export const CATEGORY_INFO: Record<OrganizationCategory, CategoryInfo> = {
  COMMUNITY: {
    label: "Community Organization",
    description: "General community and membership organizations.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Contributions",
    memberLabel: "Member",
    groupsLabel: "Groups",
  },
  PTA_PTO: {
    label: "PTA / PTO",
    description: "Parent-teacher associations and organizations.",
    experienceVertical: "PTA",
    givingTerminology: "Contributions",
    memberLabel: "Parent",
    groupsLabel: "Committees",
  },
  UNION: {
    label: "Union",
    description: "Labor unions, locals, and bargaining units.",
    experienceVertical: "UNION",
    givingTerminology: "Contributions",
    memberLabel: "Union Member",
    groupsLabel: "Committees",
  },
  HOA: {
    label: "HOA",
    description: "Homeowner and condominium associations.",
    experienceVertical: "HOA",
    givingTerminology: "Contributions",
    memberLabel: "Resident",
    groupsLabel: "Committees",
  },
  CHURCH_RELIGIOUS: {
    label: "Church / Religious Organization",
    description: "Churches, congregations, and religious communities.",
    // CHURCH-VERT-A: was COMMUNITY (Church had no experience engine of its
    // own yet). Now that CHURCH is a first-class OrganizationVertical, this
    // category should run on that engine so its nav/terminology/Give tab
    // actually apply -- see schema.prisma's OrganizationVertical doc comment
    // on why vertical and category are deliberately separate concepts.
    experienceVertical: "CHURCH",
    givingTerminology: "Giving",
    memberLabel: "Member",
    groupsLabel: "Ministries",
  },
  CULTURAL: {
    label: "Cultural Organization",
    description: "Cultural, heritage, and arts organizations.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Contributions",
    memberLabel: "Member",
    groupsLabel: "Groups",
  },
  ALUMNI: {
    label: "Alumni Association",
    description: "Alumni associations and school-affiliated networks.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Giving",
    memberLabel: "Alumni Member",
    groupsLabel: "Chapters",
  },
  PROFESSIONAL_ASSOCIATION: {
    label: "Professional Association",
    description: "Professional societies and trade associations.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Contributions",
    memberLabel: "Association Member",
    groupsLabel: "Committees",
  },
  CIVIC_ASSOCIATION: {
    label: "Civic Association",
    description: "Civic leagues and neighborhood associations.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Contributions",
    memberLabel: "Member",
    groupsLabel: "Committees",
  },
  FRATERNAL: {
    label: "Fraternal Organization",
    description: "Fraternal orders, lodges, and service organizations.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Contributions",
    memberLabel: "Member",
    groupsLabel: "Chapters",
  },
  CLUB: {
    label: "Club",
    description: "Social, hobby, and recreational clubs.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Support",
    memberLabel: "Member",
    groupsLabel: "Groups",
  },
  NONPROFIT: {
    label: "Nonprofit",
    description: "Nonprofits and charitable organizations.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Giving",
    memberLabel: "Supporter",
    groupsLabel: "Working Groups",
  },
  OTHER: {
    label: "Other",
    description: "Anything that does not fit the categories above.",
    experienceVertical: "COMMUNITY",
    givingTerminology: "Contributions",
    memberLabel: "Member",
    groupsLabel: "Groups",
  },
};

/** Legacy organizations (category null) present as their vertical. */
export function deriveCategoryFromVertical(vertical: OrganizationVertical): OrganizationCategory {
  switch (vertical) {
    case "PTA":
      return "PTA_PTO";
    case "UNION":
      return "UNION";
    case "HOA":
      return "HOA";
    case "CHURCH":
      return "CHURCH_RELIGIOUS";
    case "COMMUNITY":
      return "COMMUNITY";
  }
}

export function getEffectiveCategory(
  vertical: OrganizationVertical,
  category: OrganizationCategory | null | undefined
): OrganizationCategory {
  return category ?? deriveCategoryFromVertical(vertical);
}

/** Categories whose experience runs on a given vertical — used so a category
 * change can never silently move an organization to a different experience
 * engine (that remains a Platform Admin primaryVertical operation). */
export function categoriesForVertical(vertical: OrganizationVertical): OrganizationCategory[] {
  return (Object.keys(CATEGORY_INFO) as OrganizationCategory[]).filter(
    (category) => CATEGORY_INFO[category].experienceVertical === vertical
  );
}
