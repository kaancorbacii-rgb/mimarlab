-- MİMARLAB üyelik / gönderi sistemi şeması (D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  dept TEXT,
  photo_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS office_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  loc TEXT,
  cats TEXT,
  yil INTEGER,
  website TEXT,
  about TEXT,
  logo_url TEXT,
  awards TEXT
);
CREATE INDEX IF NOT EXISTS idx_office_owner ON office_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_office_status ON office_submissions(status);

CREATE TABLE IF NOT EXISTS project_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  slug TEXT,
  title TEXT NOT NULL,
  category TEXT,
  type TEXT,
  location TEXT,
  locationDetail TEXT,
  date TEXT,
  dateBucket TEXT,
  period TEXT,
  designer TEXT,
  photoCreditText TEXT,
  photoCreditUrl TEXT,
  description TEXT,
  images TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_owner ON project_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_status ON project_submissions(status);

CREATE TABLE IF NOT EXISTS product_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  brand TEXT,
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_owner ON product_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_product_status ON product_submissions(status);

CREATE TABLE IF NOT EXISTS job_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  office TEXT,
  loc TEXT,
  level TEXT,
  role TEXT,
  tags TEXT,
  domain TEXT,
  description TEXT,
  apply TEXT,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_owner ON job_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_job_status ON job_submissions(status);

CREATE TABLE IF NOT EXISTS architect_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  dept TEXT,
  office TEXT,
  position TEXT,
  awards TEXT,
  photo_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_architect_owner ON architect_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_architect_status ON architect_submissions(status);

CREATE TABLE IF NOT EXISTS news_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  source TEXT,
  description TEXT,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_sub_owner ON news_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_news_sub_status ON news_submissions(status);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  source TEXT,
  description TEXT,
  image_url TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);

CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_title TEXT,
  item_meta TEXT,
  item_image TEXT,
  item_href TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, item_type, item_key)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_items(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings(target_type, target_id);
