-- CHURCH-VERT-A: promote Church to a first-class OrganizationVertical
-- (previously only OrganizationCategory.CHURCH_RELIGIOUS existed, which
-- relabeled the COMMUNITY vertical engine rather than driving its own
-- navigation/terminology/capabilities). Postgres requires ADD VALUE to run
-- outside the transaction of its first use, so this stays its own migration
-- with no other schema changes.
ALTER TYPE "OrganizationVertical" ADD VALUE 'CHURCH';
