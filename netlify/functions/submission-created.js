/*
 * One In Experience · Netlify Forms → Brevo
 * Netlify runs this function automatically for every verified submission
 * of any form on the site (event name "submission-created").
 * For the form "oie-booking" it:
 *   1. creates / updates the contact in Brevo (CRM)
 *   2. sends the transactional confirmation email to the guest
 *   3. sends the internal notification to the Concierge team
 *
 * Environment variables (Netlify → Project configuration → Environment variables):
 *   BREVO_API_KEY            required  Brevo → SMTP & API → API keys
 *   BREVO_SENDER_EMAIL       required  a sender validated in Brevo (e.g. reservas@oneinexperience.com)
 *   BREVO_SENDER_NAME        optional  default "One In Experience"
 *   CONCIERGE_EMAIL          required  where the team notification goes (comma-separated for several)
 *   BREVO_LIST_ID            optional  numeric list id to add the contact to
 *   BREVO_TEMPLATE_CLIENT    optional  Brevo template id for the guest email (params below)
 *   BREVO_TEMPLATE_CONCIERGE optional  Brevo template id for the team email
 * Template params available: {{ params.NAME }}, DATE, START, GUESTS, HOTEL, ROUTE, TOTAL, WHATSAPP, COUNTRY, REF, NOTES, LANG
 */
const BREVO = "https://api.brevo.com/v3";

async function brevo(path, body) {
  const res = await fetch(BREVO + path, {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`Brevo ${path} ${res.status}: ${txt}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const COPY = {
  es: {
    subject: "Tu ruta con One In Experience está en manos de tu concierge",
    hello: (n) => `Estimado/a ${n},`,
    body: "Hemos recibido tu solicitud. Tu concierge te escribirá por WhatsApp en menos de 2 horas para confirmar cada reserva.",
    invite: "Nos encantaría hacerle llegar una invitación oficial física por parte de ONE IN EXPERIENCE directo a su hotel. Para coordinar el envío de sus pulseras de acceso, su reserva debe realizarse con al menos 3 días hábiles de antelación. En reservas de menor margen, su acceso estará garantizado y coordinado directamente en la entrada de su local seleccionado.",
    route: "Tu ruta", sign: "Con cariño, el equipo de concierge de ONE IN EXPERIENCE",
  },
  en: {
    subject: "Your One In Experience route is with your concierge",
    hello: (n) => `Dear ${n},`,
    body: "We have received your request. Your concierge will write to you on WhatsApp within 2 hours to confirm every booking.",
    invite: "We would be delighted to send an official printed invitation from ONE IN EXPERIENCE directly to your hotel. To coordinate the delivery of your access wristbands, your booking must be made at least 3 business days in advance. For bookings made at shorter notice, your access will be guaranteed and coordinated directly at the entrance of your selected venue.",
    route: "Your route", sign: "Warm regards, the ONE IN EXPERIENCE concierge team",
  },
};

function shell(inner) {
  return `<div style="background:#f6f1ec;padding:32px 12px;font-family:Georgia,'Times New Roman',serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid #401012">
  <div style="background:#401012;color:#fff;padding:22px 28px;font-size:20px;letter-spacing:.06em">ONE IN <i>Experience</i></div>
  <div style="padding:28px;color:#2b2222;font-size:15px;line-height:1.6">${inner}</div></div></div>`;
}

/* Tailor made (Plan your trip) and Events forms: CRM contact + guest acknowledgement + team notification */
async function handleRequest(payload, label) {
  const d = payload.data || {};
  const name = `${(d.name || "").trim()} ${(d.last_name || "").trim()}`.trim();
  const sender = { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || "One In Experience" };
  const sum = `<pre style="white-space:pre-wrap;font-family:inherit;background:#faf6f2;padding:14px;border-left:3px solid #c9a46a">${esc(d.summary)}</pre>`;
  const tasks = [];
  const contact = { email: d.email, updateEnabled: true, attributes: { FIRSTNAME: (d.name || "").trim(), LASTNAME: (d.last_name || "").trim() } };
  if (process.env.BREVO_LIST_ID) contact.listIds = [Number(process.env.BREVO_LIST_ID)];
  tasks.push(brevo("/contacts", contact));
  tasks.push(brevo("/smtp/email", {
    sender, to: [{ email: d.email, name }], replyTo: { email: process.env.BREVO_SENDER_EMAIL },
    subject: "We have received your request · One In Experience",
    htmlContent: shell(`<p>Dear ${esc(d.name || name)},</p><p>Thank you for contacting ONE IN EXPERIENCE. An advisor will reply with a first proposal within 24 hours, by email or WhatsApp.</p>${sum}<p>Warm regards, the ONE IN EXPERIENCE team</p>`),
  }));
  const team = (process.env.CONCIERGE_EMAIL || "").split(",").map((e) => e.trim()).filter(Boolean).map((email) => ({ email }));
  if (team.length) tasks.push(brevo("/smtp/email", {
    sender, to: team, replyTo: { email: d.email, name },
    subject: `Nueva solicitud ${label} · ${name} · ${d.event_date || d.arrival || ""}`,
    htmlContent: shell(`<p><b>Nueva solicitud desde el formulario ${esc(label)}</b></p>${sum}<p>Página: ${esc(d.page || "")}</p>`),
  }));
  const results = await Promise.allSettled(tasks);
  results.filter((r) => r.status === "rejected").forEach((r) => console.error(r.reason));
  return { statusCode: 200, body: "ok" };
}

exports.handler = async (event) => {
  let payload;
  try { payload = JSON.parse(event.body).payload; } catch (e) { return { statusCode: 400, body: "bad body" }; }
  const REQUEST_FORMS = { "oie-tailor-made": "Tailor made", "oie-events": "Events" };
  if (!payload || (payload.form_name !== "oie-booking" && !REQUEST_FORMS[payload.form_name])) return { statusCode: 200, body: "ignored" };
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    console.error("Missing BREVO_API_KEY / BREVO_SENDER_EMAIL");
    return { statusCode: 200, body: "brevo not configured" };
  }
  if (REQUEST_FORMS[payload.form_name]) return handleRequest(payload, REQUEST_FORMS[payload.form_name]);
  const d = payload.data || {};
  const lang = String(d.lang || "en").slice(0, 2) === "es" ? "es" : "en";
  const T = COPY[lang];
  const name = (d.name || "").trim();
  const sender = { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || "One In Experience" };
  const params = {
    NAME: name, DATE: d.date || "", START: d.start || "", GUESTS: d.guests || "", HOTEL: d.hotel || "",
    ROUTE: d.route || "", TOTAL: d.total || "", WHATSAPP: d.whatsapp || "", COUNTRY: d.country || "",
    REF: d.ref || "", NOTES: d.notes || "", LANG: lang,
  };
  const routeHtml = `<pre style="white-space:pre-wrap;font-family:inherit;background:#faf6f2;padding:14px;border-left:3px solid #c9a46a">${esc(d.route)}</pre>`;
  const tasks = [];

  // 1 · CRM contact
  const [first, ...rest] = name.split(" ");
  const contact = { email: d.email, updateEnabled: true, attributes: { FIRSTNAME: first || "", LASTNAME: rest.join(" ") } };
  if (process.env.BREVO_LIST_ID) contact.listIds = [Number(process.env.BREVO_LIST_ID)];
  tasks.push(brevo("/contacts", contact));

  // 2 · guest confirmation
  const guestMail = { sender, to: [{ email: d.email, name }], replyTo: { email: process.env.BREVO_SENDER_EMAIL } };
  if (process.env.BREVO_TEMPLATE_CLIENT) Object.assign(guestMail, { templateId: Number(process.env.BREVO_TEMPLATE_CLIENT), params });
  else Object.assign(guestMail, {
    subject: T.subject,
    htmlContent: shell(`<p>${esc(T.hello(name))}</p><p>${T.body}</p><h3 style="font-weight:400">${T.route}</h3>${routeHtml}` +
      (d.hotel ? `<p style="font-style:italic;color:#5a4636;border-left:3px solid #c9a46a;padding-left:12px">${T.invite}</p>` : "") +
      `<p>${T.sign}</p>`),
  });
  tasks.push(brevo("/smtp/email", guestMail));

  // 3 · concierge notification
  const team = (process.env.CONCIERGE_EMAIL || "").split(",").map((e) => e.trim()).filter(Boolean).map((email) => ({ email }));
  if (team.length) {
    const teamMail = { sender, to: team, replyTo: { email: d.email, name } };
    if (process.env.BREVO_TEMPLATE_CONCIERGE) Object.assign(teamMail, { templateId: Number(process.env.BREVO_TEMPLATE_CONCIERGE), params });
    else Object.assign(teamMail, {
      subject: `Nueva ruta · ${name} · ${d.date || ""} ${d.start || ""} · ${d.total || ""}`,
      htmlContent: shell(`<p><b>Nueva solicitud desde el route builder</b></p>
        <p>Cliente: ${esc(name)} · ${esc(d.email)} · WhatsApp ${esc(d.whatsapp)} · ${esc(d.country)}<br>
        Hotel / lugar de estadía: ${esc(d.hotel || "—")}<br>${d.instagram ? `Instagram (guest list): ${esc(d.instagram)}<br>` : ""}Código: ${esc(d.ref || "—")} · Idioma: ${esc(lang)}</p>${routeHtml}
        <p>Notas: ${esc(d.notes || "—")}</p>`),
    });
    tasks.push(brevo("/smtp/email", teamMail));
  }

  const results = await Promise.allSettled(tasks);
  results.filter((r) => r.status === "rejected").forEach((r) => console.error(r.reason));
  return { statusCode: 200, body: "ok" };
};
