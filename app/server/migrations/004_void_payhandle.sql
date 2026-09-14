-- Expense audit trail (void instead of delete) and payout handles.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_handle text;
