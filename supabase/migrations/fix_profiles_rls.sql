CREATE POLICY "Allow anon to insert profiles" ON profiles FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow authenticated to insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);