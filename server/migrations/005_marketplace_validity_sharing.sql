-- Category approvals have an end date, and a business decides what a provider may see.

-- The reviewer sets the end date; it can never be later than the earliest
-- expiry of the credentials the approval rests on.
ALTER TABLE service_authorizations ADD COLUMN valid_until date;

-- Approvals made before this column existed end at their earliest basis
-- credential expiry, or immediately when none had one (re-approval needed).
UPDATE service_authorizations a
   SET valid_until = COALESCE((SELECT min(v.valid_until) FROM professional_verifications v WHERE v.id = ANY(a.basis_verification_ids)), a.decided_at::date)
 WHERE a.status = 'approved';

ALTER TABLE service_authorizations
  ADD CONSTRAINT service_authorizations_approved_has_end CHECK (status <> 'approved' OR valid_until IS NOT NULL);

-- Off by default: the linked nonconformity's summary is shared only when the business ticks it.
ALTER TABLE service_requests ADD COLUMN share_ncr_summary boolean NOT NULL DEFAULT false;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_share_needs_ncr CHECK (NOT share_ncr_summary OR ncr_id IS NOT NULL);
