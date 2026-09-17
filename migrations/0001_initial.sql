PRAGMA foreign_keys = ON;

CREATE TABLE members (
  telegram_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_action_key TEXT NOT NULL UNIQUE,
  amount_rsd INTEGER NOT NULL CHECK (amount_rsd > 0),
  category_id TEXT NOT NULL REFERENCES categories(id),
  spent_on TEXT NOT NULL CHECK (spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  comment TEXT,
  created_by TEXT NOT NULL REFERENCES members(telegram_user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX expenses_spent_on_idx ON expenses(spent_on);
CREATE INDEX expenses_category_spent_on_idx ON expenses(category_id, spent_on);

INSERT INTO categories (id, name, sort_order) VALUES
  ('groceries', 'Продукты', 1),
  ('snacks', 'Снеки и сладости', 2),
  ('restaurants', 'Рестораны', 3),
  ('entertainment', 'Развлечения', 4),
  ('household', 'Товары для дома', 5),
  ('electronics', 'Техника', 6),
  ('documents', 'Документы', 7),
  ('business', 'Фирмы', 8),
  ('health', 'Здоровье', 9),
  ('personal-care', 'Гигиена и красота', 10),
  ('transport', 'Транспорт', 11),
  ('clothes', 'Одежда', 12),
  ('nicotine', 'Никотин', 13),
  ('utilities', 'Коммунальные услуги', 14),
  ('other', 'Другое', 15);
