import { supabase } from "../lib/supabase";

function normalizeProject(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};

  return {
    ...payload,
    id: row.id,
    title: payload.title || row.title || "럭키쿠지",
    updatedAt: payload.updatedAt || row.updated_at || "",
  };
}

export async function loadKujiProjects(userId) {
  if (!userId) throw new Error("로그인 사용자 정보가 없습니다.");

  const { data, error } = await supabase
    .from("kuji_projects")
    .select("id, user_id, title, payload, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(normalizeProject);
}

export async function syncKujiProjects(userId, projects) {
  if (!userId) throw new Error("로그인 사용자 정보가 없습니다.");

  const safeProjects = Array.isArray(projects)
    ? projects.filter((project) => project?.id)
    : [];

  const rows = safeProjects.map((project) => ({
    id: String(project.id),
    user_id: userId,
    title: String(project.title || "럭키쿠지"),
    payload: project,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("kuji_projects")
      .upsert(rows, { onConflict: "id" });

    if (upsertError) throw upsertError;
  }

  // 앱에서 삭제한 쿠지는 서버에서도 삭제합니다.
  const { data: existing, error: selectError } = await supabase
    .from("kuji_projects")
    .select("id")
    .eq("user_id", userId);

  if (selectError) throw selectError;

  const keepIds = new Set(rows.map((row) => row.id));
  const deleteIds = (existing || [])
    .map((row) => row.id)
    .filter((id) => !keepIds.has(id));

  if (deleteIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("kuji_projects")
      .delete()
      .eq("user_id", userId)
      .in("id", deleteIds);

    if (deleteError) throw deleteError;
  }

  return rows;
}
