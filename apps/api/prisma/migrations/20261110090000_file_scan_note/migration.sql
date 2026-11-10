-- Why an upload was refused (shown to the uploader), or what the sanitizer removed
ALTER TABLE "FileObject" ADD COLUMN "scanNote" TEXT;
