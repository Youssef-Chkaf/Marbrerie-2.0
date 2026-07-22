// Client HTTP : session par cookie httpOnly + jeton Bearer en secours.

import { state } from "./state.js";

let token = localStorage.getItem("marbexa_token") || null;

export function setToken(value) {
  token = value;
  if (value) localStorage.setItem("marbexa_token", value);
  else localStorage.removeItem("marbexa_token");
}

export async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erreur ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function refresh() {
  state.data = await request("/api/bootstrap");
  return state.data;
}

export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export const fileToBase64 = async (file) => {
  const dataUrl = await fileToDataUrl(file);
  return String(dataUrl).split(",")[1] || "";
};
