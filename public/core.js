export const $ = (selector) => document.querySelector(selector);
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let csrf;
export function setToken(value) {
  csrf = value;
}
export function notice(message, error = false) {
  const el = $("#notice");
  el.textContent = message;
  el.dataset.error = String(error);
}
export async function api(path, payload) {
  let response;
  try {
    response = await fetch(
      path,
      payload === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf || "",
            },
            body: JSON.stringify(payload),
          },
    );
  } catch {
    throw new Error(
      "Connection lost. Your draft is still here. Retry the same save safely.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server response could not be read. Your draft is still here; retry safely.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      data.error || "The request failed; your draft is kept.",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
