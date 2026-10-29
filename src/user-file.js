// Plugin data that should not live in the shared settings.json is kept as JSON files in the user folder:
//   ST: data/<user>/user/files/<name>   TT: <data_root>/default-user/user/files/<name>
// Both hosts expose the same /api/files/upload + /user/files/ routes, and deleting the
// extension folder never touches user files. The icon library and the scheme library both use this.
export const USER_FILE_URL = name => `/user/files/${name}`;

const toBase64 = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** Resolves to the parsed JSON, or null when the file does not exist yet. */
export async function readUserJson(name, label) {
  const response = await fetch(`${USER_FILE_URL(name)}?t=${Date.now()}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读取${label}失败（HTTP ${response.status}）`);
  return response.json();
}

export async function writeUserJson(name, data, label) {
  const ctx = window.SillyTavern?.getContext?.();
  const headers = { ...(ctx?.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' };
  const body = JSON.stringify({ name, data: toBase64(JSON.stringify(data, null, 1)) });
  const response = await fetch('/api/files/upload', { method: 'POST', headers, body });
  if (!response.ok) throw new Error(`保存${label}失败（HTTP ${response.status}）`);
}
