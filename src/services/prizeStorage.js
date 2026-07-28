import { supabase } from "../lib/supabase";

const BUCKET = "prize-images";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function safeSegment(value) {
  return String(value || "item")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function extensionFromFile(file) {
  const fromName = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const subtype = String(file?.type || "image/webp").split("/")[1] || "webp";
  return subtype === "jpeg" ? "jpg" : subtype.replace(/[^a-z0-9]/g, "") || "webp";
}

export function validatePrizeImageFile(file) {
  if (!file) throw new Error("이미지 파일을 선택해 주세요.");
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("이미지 파일만 등록할 수 있습니다.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 2MB 이하 파일을 사용해 주세요.");
  }
}

export async function uploadPrizeImage(userId, kujiId, prizeId, file) {
  if (!userId) throw new Error("로그인 사용자 정보가 없습니다.");
  validatePrizeImageFile(file);

  const path = `${userId}/${safeSegment(kujiId)}/${safeSegment(prizeId)}-${Date.now()}.${extensionFromFile(file)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("업로드된 이미지 주소를 만들지 못했습니다.");
  return data.publicUrl;
}

export async function uploadPrizeDataUrl(userId, kujiId, prizeId, dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const type = blob.type || "image/webp";
  const ext = type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : "webp";
  const file = new File([blob], `migrated.${ext}`, { type });
  return uploadPrizeImage(userId, kujiId, prizeId, file);
}

export function getPrizeImagePath(publicUrl) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const value = String(publicUrl || "");
  const index = value.indexOf(marker);
  if (index < 0) return "";
  return decodeURIComponent(value.slice(index + marker.length).split("?")[0]);
}

export async function deletePrizeImage(publicUrl) {
  const path = getPrizeImagePath(publicUrl);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
