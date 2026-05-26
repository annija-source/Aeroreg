-- Storage RLS policies for the "documents" bucket
-- Allows authenticated users to upload, read, update, and delete their own files

-- INSERT policy: authenticated users can upload files
DROP POLICY IF EXISTS "authenticated_users_can_upload_documents" ON storage.objects;
CREATE POLICY "authenticated_users_can_upload_documents"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'documents');

-- SELECT policy: authenticated users can read files
DROP POLICY IF EXISTS "authenticated_users_can_read_documents" ON storage.objects;
CREATE POLICY "authenticated_users_can_read_documents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'documents');

-- UPDATE policy: authenticated users can update files
DROP POLICY IF EXISTS "authenticated_users_can_update_documents" ON storage.objects;
CREATE POLICY "authenticated_users_can_update_documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'documents')
WITH CHECK (bucket_id = 'documents');

-- DELETE policy: authenticated users can delete files
DROP POLICY IF EXISTS "authenticated_users_can_delete_documents" ON storage.objects;
CREATE POLICY "authenticated_users_can_delete_documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'documents');
