CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  region TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  sold_on TEXT NOT NULL
);

CREATE INDEX sales_region_day ON sales (region, sold_on);
