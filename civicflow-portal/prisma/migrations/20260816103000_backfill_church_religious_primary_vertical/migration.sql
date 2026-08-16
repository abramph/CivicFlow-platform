-- CHURCH-VERT-A follow-up: backfill primaryVertical for existing
-- organizations whose category is already CHURCH_RELIGIOUS.
-- CATEGORY_INFO.CHURCH_RELIGIOUS.experienceVertical was promoted from
-- COMMUNITY to CHURCH (see organization-category.ts), but category and
-- primaryVertical are two independent columns. Existing CHURCH_RELIGIOUS
-- orgs (e.g. "Unestra Demo Church") were created before CHURCH existed as a
-- vertical and are still primaryVertical=COMMUNITY, which now mismatches
-- categoriesForVertical() and breaks their category picker (current
-- category no longer appears among the options for their stored vertical).
-- One-time backfill -- new organizations get primaryVertical set directly
-- at creation and never need this.
UPDATE "Organization"
SET "primaryVertical" = 'CHURCH'
WHERE "category" = 'CHURCH_RELIGIOUS' AND "primaryVertical" != 'CHURCH';
