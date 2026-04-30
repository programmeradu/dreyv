const STUDIO_PASS_STORAGE_KEY = "dreyv-studio-pass";
const STUDIO_PASS_HEADER = "x-dreyv-studio-pass";

function storedStudioPass() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STUDIO_PASS_STORAGE_KEY);
}

export function rememberStudioPass(password: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STUDIO_PASS_STORAGE_KEY, password);
}

export function studioAuthHeaders(): HeadersInit {
  const pass = storedStudioPass();
  return pass ? { [STUDIO_PASS_HEADER]: pass } : {};
}

export function studioJsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json", ...studioAuthHeaders() };
}
