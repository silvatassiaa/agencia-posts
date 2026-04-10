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
  format      TEXT,
  hook        TEXT,
  theme       TEXT,
  rationale   TEXT,
  position    INTEGER,
  selected    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Post queue
CREATE TABLE IF NOT EXISTS post_queue (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  idea_id      UUID REFERENCES post_ideas(id) ON DELETE SET NULL,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  copy         JSONB,
  art_urls     JSONB,
  priority     INTEGER DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_ideas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_queue    ENABLE ROW LEVEL SECURITY;

-- Dropar policies existentes antes de recriar (evita erro de duplicata)
DROP POLICY IF EXISTS "profiles_self"        ON profiles;
DROP POLICY IF EXISTS "clients_admin"        ON clients;
DROP POLICY IF EXISTS "sessions_via_client"  ON post_sessions;
DROP POLICY IF EXISTS "ideas_via_client"     ON post_ideas;
DROP POLICY IF EXISTS "queue_via_client"     ON post_queue;

CREATE POLICY "profiles_self" ON profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "clients_admin" ON clients
  FOR ALL USING (admin_id = auth.uid() OR user_id = auth.uid());

CREATE POLICY "sessions_via_client" ON post_sessions
  FOR ALL USING (
    client_id IN (SELECT id FROM clients WHERE admin_id = auth.uid() OR user_id = auth.uid())
  );

CREATE POLICY "ideas_via_client" ON post_ideas
  FOR ALL USING (
    client_id IN (SELECT id FROM clients WHERE admin_id = auth.uid() OR user_id = auth.uid())
  );

CREATE POLICY "queue_via_client" ON post_queue
  FOR ALL USING (
    client_id IN (SELECT id FROM clients WHERE admin_id = auth.uid() OR user_id = auth.uid())
  );

-- ============================================================
-- STORAGE BUCKET para artes geradas
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('post-arts', 'post-arts', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "arts_public_read"         ON storage.objects;
DROP POLICY IF EXISTS "arts_authenticated_write" ON storage.objects;

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
  INSERT INTO public.profiles (id, role, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'client'),
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;  -- evita erro se já existir
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
