export const prerender = false;
import type { APIRoute } from "astro";
import CheckField from "../components/CheckField.js";

console.error("!!! debugtest.ts module top level", typeof CheckField);

export const GET: APIRoute = async () => {
  console.error("!!! debugtest.ts GET handler hit");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
