-- Outside verifier limited to selected cases; training content, assignments and field verification.
-- Additive: no existing row is changed or removed.
ALTER TABLE access_grants ADD COLUMN ncr_ids uuid[];

-- ─── Training content: a course has versions; each version moves draft → in_review → published → archived ───
-- company_id NULL = platform example content (labelled; read-only for businesses).
CREATE TABLE training_courses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies(id),
  is_example  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (company_id IS NOT NULL OR is_example)
);
CREATE TABLE training_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES training_courses(id),
  company_id    uuid REFERENCES companies(id),
  version       integer NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','archived')),
  title         text NOT NULL,
  summary       text NOT NULL DEFAULT '',
  body          text NOT NULL,
  video_url     text,
  -- [{ "q": "...", "options": ["..",".."], "answer": 0 }]; the answer is never sent to a learner.
  quiz          jsonb NOT NULL DEFAULT '[]',
  pass_score    integer NOT NULL DEFAULT 80 CHECK (pass_score BETWEEN 1 AND 100),
  minutes       integer,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_by  uuid REFERENCES users(id),
  submitted_at  timestamptz,
  published_by  uuid REFERENCES users(id),
  published_at  timestamptz,
  review_notes  text,
  archived_at   timestamptz,
  UNIQUE (course_id, version)
);
CREATE UNIQUE INDEX training_one_published ON training_versions (course_id) WHERE status = 'published';
-- What a course is about: a check (task template), an obligation (rule code) or a hazard type.
CREATE TABLE training_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES training_courses(id),
  company_id uuid REFERENCES companies(id),
  kind       text NOT NULL CHECK (kind IN ('task_template','rule','hazard')),
  ref        text NOT NULL,
  UNIQUE (course_id, kind, ref)
);
-- A person is asked to take one published version. Each state is a separate fact with its time.
CREATE TABLE training_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  site_id           uuid NOT NULL,
  course_id         uuid NOT NULL REFERENCES training_courses(id),
  version_id        uuid NOT NULL REFERENCES training_versions(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  assigned_by       uuid NOT NULL REFERENCES users(id),
  assigned_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  due_at            timestamptz,
  reason            text NOT NULL,
  ncr_id            uuid REFERENCES nonconformities(id),
  action_id         uuid REFERENCES ncr_actions(id),
  read_at           timestamptz,
  completed_at      timestamptz,
  passed_at         timestamptz,
  best_score        integer,
  attempts          integer NOT NULL DEFAULT 0,
  field_verified_at timestamptz,
  field_verified_by uuid REFERENCES users(id),
  field_notes       text,
  field_result      text CHECK (field_result IN ('effective','not_effective')),
  field_action_id   uuid REFERENCES ncr_actions(id),
  cancelled_at      timestamptz,
  cancel_reason     text,
  FOREIGN KEY (company_id, site_id) REFERENCES sites(company_id, id),
  CHECK (field_verified_at IS NULL OR (field_verified_by IS NOT NULL AND field_verified_by <> user_id AND length(field_notes) >= 10 AND field_result IS NOT NULL))
);
CREATE UNIQUE INDEX training_assignment_live ON training_assignments (course_id, user_id, COALESCE(ncr_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE cancelled_at IS NULL AND field_verified_at IS NULL;
CREATE TABLE training_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  assignment_id uuid NOT NULL REFERENCES training_assignments(id),
  answers       jsonb NOT NULL,
  score         integer NOT NULL,
  passed        boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Example content (company_id NULL) is readable by everyone; business content only inside the business.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_courses','training_versions','training_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_or_example ON %I USING (company_id IS NULL OR app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['training_assignments','training_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_tenant_ok(company_id)) WITH CHECK (app_tenant_ok(company_id))', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON training_courses, training_versions, training_assignments TO goverhub_app;
GRANT SELECT, INSERT, DELETE ON training_links TO goverhub_app;
GRANT SELECT, INSERT ON training_attempts TO goverhub_app;

-- Two EXAMPLE courses (not legal requirements, not approved expert content). Inserted once.
DO $$
DECLARE c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('app.system', 'on', true);
  INSERT INTO training_courses (id, company_id, is_example) VALUES (c1, NULL, true), (c2, NULL, true);
  INSERT INTO training_versions (course_id, company_id, version, status, title, summary, body, quiz, pass_score, minutes, published_at) VALUES
  (c1, NULL, 1, 'published', 'Soğutucu kapısı ve sıcaklık kontrolü (ÖRNEK)', 'Kapı contası, kapının kapanması ve sıcaklık ölçümü: ne, neden, nasıl.',
   E'Bu bir ÖRNEK eğitim içeriğidir; mevzuat metni ya da onaylı uzman görüşü değildir.\n\n1. Soğutucu kapısı her açılıştan sonra tam kapanmalı. Kapı aralık kalırsa iç sıcaklık hızla yükselir.\n2. Contayı haftada bir kontrol et: yırtık, sertleşme ya da boşluk varsa yöneticine bildir.\n3. Sıcaklığı kalibre termometreyle ölç; ekrandaki değere tek başına güvenme.\n4. Limit dışı bir değer görürsen ürünleri güvenli üniteye taşı ve uygunsuzluk bildir.',
   '[{"q":"Kapı contasında yırtık gördün. Ne yaparsın?","options":["Görmezden gelirim","Yöneticime bildiririm ve kapıyı kontrol ederim","Kapıyı açık bırakırım"],"answer":1},
     {"q":"Sıcaklığı neyle ölçersin?","options":["Kalibre termometreyle","Elimle dokunarak","Yalnız ekrandaki değere bakarak"],"answer":0},
     {"q":"Limit dışı değerde ilk adım?","options":["Ürünleri güvenli üniteye taşımak","Hiçbir şey","Ertesi gün tekrar bakmak"],"answer":0}]', 67, 5, now()),
  (c2, NULL, 1, 'published', 'Eldiven kullanımı ve el hijyeni (ÖRNEK)', 'Ne zaman eldiven değiştirilir, el ne zaman yıkanır.',
   E'Bu bir ÖRNEK eğitim içeriğidir; mevzuat metni ya da onaylı uzman görüşü değildir.\n\n1. Çiğ ürün ile hazır ürün arasında eldiven değiştir.\n2. Eldiven takmadan önce ve çıkardıktan sonra ellerini yıka.\n3. Yırtılan eldiveni hemen değiştir.',
   '[{"q":"Çiğ tavuktan sonra salata hazırlayacaksın.","options":["Aynı eldivenle devam ederim","Eldiveni değiştirir, ellerimi yıkarım"],"answer":1},
     {"q":"Eldiven yırtıldı.","options":["Hemen değiştiririm","Vardiya sonuna kadar kullanırım"],"answer":0}]', 100, 3, now());
  INSERT INTO training_links (course_id, company_id, kind, ref) VALUES
    (c1, NULL, 'hazard', 'cold_chain_temperature'), (c1, NULL, 'task_template', 'fridge_temp'), (c1, NULL, 'rule', 'EX-COLD-CHAIN'),
    (c2, NULL, 'hazard', 'personal_hygiene'), (c2, NULL, 'task_template', 'glove_daily'), (c2, NULL, 'rule', 'EX-GLOVE');
END $$;

-- Demo reset clears business training rows too (example content stays).
CREATE OR REPLACE FUNCTION demo_reset_training() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.system', 'on', true);
  DELETE FROM training_attempts WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM training_assignments WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM training_links WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM training_versions WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
  DELETE FROM training_courses WHERE company_id IN (SELECT id FROM companies WHERE is_demo);
END $$;
ALTER FUNCTION demo_reset() RENAME TO demo_reset_before_training;
CREATE FUNCTION demo_reset() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM demo_reset_training();
  RETURN demo_reset_before_training();
END $$;
