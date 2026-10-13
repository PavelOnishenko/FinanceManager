ALTER TABLE categories ADD COLUMN name_key TEXT NOT NULL DEFAULT '';

UPDATE categories SET name_key = CASE id
  WHEN 'groceries' THEN 'продукты'
  WHEN 'snacks' THEN 'снеки и сладости'
  WHEN 'restaurants' THEN 'рестораны'
  WHEN 'entertainment' THEN 'развлечения'
  WHEN 'household' THEN 'товары для дома'
  WHEN 'electronics' THEN 'техника'
  WHEN 'documents' THEN 'документы'
  WHEN 'business' THEN 'фирмы'
  WHEN 'health' THEN 'здоровье'
  WHEN 'personal-care' THEN 'гигиена и красота'
  WHEN 'transport' THEN 'транспорт'
  WHEN 'clothes' THEN 'одежда'
  WHEN 'nicotine' THEN 'никотин'
  WHEN 'utilities' THEN 'коммунальные услуги'
  WHEN 'other' THEN 'другое'
  WHEN 'gifts' THEN 'подарки'
  WHEN 'lost-money' THEN 'потерянные деньги'
  WHEN 'subscriptions' THEN 'подписки'
  WHEN 'communication' THEN 'связь'
  ELSE name_key END;

CREATE UNIQUE INDEX categories_name_key_idx ON categories(name_key);
