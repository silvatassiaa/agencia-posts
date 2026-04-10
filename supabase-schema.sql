-- ============================================================
-- AGENCIA POSTS — Schema Supabase
-- Execute esse script no SQL Editor do Supabase
-- ============================================================

-- Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role        TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin','client')),
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Clients (businesses managed by the agency)
CREATE TABLE IF NOT EXISTS clients (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  admin_id         UUID REFERENCES profiles(id) NOT NULL,
  business_name    TEXT NOT NULL,
  website          TEXT,
  instagram_handle TEXT,
  briefing         JSONB DEFAULT '{}',
  brand_colors     JSONB DEFAULT '{"primary":"#6366f1","secondary":"#111827","text":"#ffffff"}',
  logo_url         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Post sessions (each "generate 30 ideas" run per client)
CREATE TABLE IF NOT EXISTS post_sessions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Post ideas (30 ideas per session)
CREATE TABLE IF NOT EXISTS post_ideas (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  UUID REFERENCES post_sessions(id) ON DELETE CASCADE NOT NULL,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  title       TEXT NOT NULL,
  format      TEXT, -- carousel, reels, feed, stories
  hook        TEXT,
  theme       TEXT,
  rationale   TEXT,
  position    INTEGER,
  selected    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Post queue (selected ideas waiting to be produced)
CREATE TABLE IF NOT EXISTS post_queue (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  idea_id      UUID REFERENCES post_ideas(id) ON DELETE SET NULL,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  copy         JSONB,   -- {caption, hashtags, cta, talking_points, slide_texts}
  art_urls     JSONB,   -- array of PNG URLs stored in Supabase Storage
  priority     INTEGER DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_ideas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_queue  ENABLE ROW LEVEL SECURITY;

-- Profiles: users see only themselves
CREATE POLICY "profiles_self" ON profiles
  FOR ALL USING (auth.uid() = id);

-- Clients: admin sees all their clients; client sees only their own
CREATE POLICY "clients_admin" ON clients
  FOR ALL USING (
    admin_id = auth.uid()
    OR user_id = auth.uid()
  );

-- Post sessions: via client access
CREATE POLICY "sessions_via_client" ON post_sessions
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients
      WHERE admin_id = auth.uid() OR user_id = auth.uid()
    )
  );

-- Post ideas: via client access
CREATE POLICY "ideas_via_client" ON post_ideas
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients
      WHERE admin_id = auth.uid() OR user_id = auth.uid()
    )
  );

-- Post queue: via client access
CREATE POLICY "queue_via_client" ON post_queue
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients
      WHERE admin_id = auth.uid() OR user_id = auth.uid()
    )
  );

-- ============================================================
-- STORAGE BUCKET para artes geradas
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('post-arts', 'post-arts', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "arts_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-arts');

CREATE POLICY "arts_authenticated_write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'post-arts' AND auth.role() = 'authenticated');

-- ============================================================
-- TRIGGER: cria profile automaticamente após signup
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, role, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
