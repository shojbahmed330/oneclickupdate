insert into storage.buckets (id, name, public) values ('apk-builds', 'apk-builds', true) on conflict (id) do update set public = true;

create policy "apk_builds_public_read" on storage.objects for select using (bucket_id = 'apk-builds');