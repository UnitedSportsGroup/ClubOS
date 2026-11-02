-- Shop Orders tab (United Prints workspace): who gets an email for every new
-- paid order from ANY of the club shops (CUFC, SIU, MFL, CIC). Per person, set
-- from the tab itself. Default off — nobody is subscribed silently.
ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_order_emails boolean NOT NULL DEFAULT false;
