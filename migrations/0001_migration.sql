CREATE TABLE user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  updated_at TEXT,
  name TEXT,
  email TEXT,
  password TEXT
);

CREATE INDEX idx_user_email ON user(email);
