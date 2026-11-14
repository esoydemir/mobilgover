-- Appointment history and message threads were ordered by created_at (a wall-clock value). A clock that steps back, or two rows in the
-- same instant, could reorder a history. An identity column gives the true insertion order; created_at stays for display.
ALTER TABLE service_appointments ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE service_messages ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
