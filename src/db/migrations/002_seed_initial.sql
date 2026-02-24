-- Seed only on first run
INSERT OR IGNORE INTO categories (name) VALUES ('General'), ('Premium');

INSERT INTO members (first_name, last_name, email, status, category_id)
SELECT 'Sample', 'Member', 'sample@example.com', 'active', (SELECT id FROM categories LIMIT 1)
WHERE (SELECT COUNT(*) FROM members) = 0;

INSERT INTO events (name, date, location, notes)
SELECT 'Sample Event', date('now', '+7 days'), 'Main Hall', 'Welcome event'
WHERE (SELECT COUNT(*) FROM events) = 0;

INSERT INTO campaigns (name, start_date, end_date, notes)
SELECT 'Sample Campaign', date('now'), date('now', '+90 days'), 'Initial campaign'
WHERE (SELECT COUNT(*) FROM campaigns) = 0;

INSERT INTO transactions (type, amount_cents, occurred_on, member_id, note)
SELECT 'dues', 2500, date('now', '-7 days'), (SELECT id FROM members LIMIT 1), 'Sample dues'
WHERE (SELECT COUNT(*) FROM transactions) = 0;

INSERT INTO transactions (type, amount_cents, occurred_on, member_id, note)
SELECT 'donation', 5000, date('now', '-3 days'), (SELECT id FROM members LIMIT 1), 'Sample donation'
WHERE (SELECT COUNT(*) FROM transactions) = 1;

INSERT INTO transactions (type, amount_cents, occurred_on, note)
SELECT 'expense', -1500, date('now', '-1 days'), 'Sample expense'
WHERE (SELECT COUNT(*) FROM transactions) = 2;
