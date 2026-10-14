CREATE TABLE instance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_currency TEXT NOT NULL,
  finance_time_zone TEXT NOT NULL
);
