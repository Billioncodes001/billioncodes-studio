export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (amount, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
let token, draw;
export let state;
export function notice(message, error = false) {
  const el = $("#notice");
  el.textContent = message;
  el.dataset.error = String(error);
}
export async function init(render) {
  draw = render;
  const controls = [
    ...document.querySelectorAll("button,input,select,textarea"),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });
  try {
    const response = await fetch("/api/state");
    if (!response.ok)
      throw new Error("Cannot load the workspace. Reload to retry.");
    const data = await response.json();
    state = data.state;
    token = data.csrf;
    render(state);
    controls.forEach((control) => {
      control.disabled = false;
    });
  } catch (error) {
    notice(error.message, true);
  }
}
export async function action(payload) {
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save.");
    state = data.state;
    draw(state);
    notice(data.message);
    return data;
  } catch (error) {
    notice(error.message, true);
    return null;
  }
}
export function form(selector, handler) {
  $(selector).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await handler(
        Object.fromEntries(new FormData(event.target)),
        event.target,
      );
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
