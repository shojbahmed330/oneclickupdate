import { supabase } from "@/integrations/supabase/client";

export const SUPPORT_BUCKET = "support-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf",
  "application/zip",
  "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const sanitize = (name: string) =>
  name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";

/**
 * Uploads a single file to support-attachments.
 * Returns the storage path stored in support_messages.attachment_url.
 * Path: {uploaderUid}/{ticketIdOrNew}/{uuid}-{name}
 */
export async function uploadSupportAttachment(
  file: File,
  uploaderUid: string,
  ticketId: string | "new",
): Promise<string> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("File too large (max 10MB)");
  if (file.type && !ALLOWED.includes(file.type)) {
    throw new Error("Unsupported file type");
  }
  const path = `${uploaderUid}/${ticketId}/${crypto.randomUUID()}-${sanitize(file.name)}`;
  const { error } = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

/** Generates a short-lived signed URL for viewing/downloading. */
export async function getAttachmentSignedUrl(path: string, expiresIn = 60 * 30): Promise<string | null> {
  const { data } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

export const fileNameFromPath = (path: string) => {
  const last = path.split("/").pop() || path;
  // strip the uuid- prefix we add on upload
  return last.replace(/^[0-9a-f-]{36}-/i, "");
};
