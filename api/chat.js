// api/chat.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { message = "", user = "", name = "" } = req.body || {};

    // 1) Fetch inventory feed from your Apps Script
    const SHEETS_API_URL = process.env.SHEETS_API_URL;
    const r = await fetch(SHEETS_API_URL);
    if (!r.ok) throw new Error(`Sheets API error: ${r.status}`);
    const data = await r.json();

    // Expecting: data.rows = array of units (adjust if your shape differs)
    const rows = Array.isArray(data.rows) ? data.rows : (data.data || data) || [];
    // Simple filter stub (you can improve later using the "message" text):
    // prioritize price_status === "Priority", then take top 3
    const prioritized = rows
      .filter(u => (u?.price_status || "").toLowerCase().includes("priority"))
      .concat(rows.filter(u => !(u?.price_status || "").toLowerCase().includes("priority")));

    const top = prioritized.slice(0, 3);

    const toTitle = (u) => {
      const yr = u?.year ? `${u.year}` : "";
      const brand = u?.brand || "";
      const model = u?.model || "";
      const variant = u?.variant || "";
      return [yr, brand, model, variant].filter(Boolean).join(" ");
    };

    const toDetails = (u) => {
      const price = u?.srp ? `₱${Number(u.srp).toLocaleString("en-PH")}` : "Price upon viewing";
      const km = u?.mileage ? `${u.mileage} km` : "—";
      const trans = u?.transmission || "—";
      const city = u?.city || u?.ncr_zone || u?.province || "—";
      return `${price} • ${km} • ${trans} • ${city}`;
    };

    const toImage = (u) => {
      // Prefer image_1; fallback to any image field present
      const keys = Object.keys(u || {}).filter(k => k.startsWith("image_"));
      return u?.image_1 || (keys.length ? u[keys[0]] : null);
    };

    const formatted_list = top.map((u, i) => {
      return `${i + 1}) ${toEmoji(i)} ${toTitle(u)} • ${toDetails(u)}`;
    });

    const images = top.map(toImage).filter(Boolean);

    const formatted_message = formatted_list.length
      ? `✅ May ${top.length} tayong swak na options para sa’yo, ${name || "buyer"}:\n\n` +
        formatted_list.join("\n") +
        `\n\nGusto mo bang *schedule viewing* o *apply for financing*? Sabihin mo lang: "schedule" o "apply".`
      : `Pasensya na, wala pang exact match based sa hinanap mo.\n` +
        `Pwede mong i-send ang city, budget, transmission, at body type (hal: "QC 600k AT sedan") para makapag-match tayo agad.`;

    return res.status(200).json({
      success: true,
      total_units: top.length,
      formatted_list,
      formatted_message,
      images
    });
  } catch (err) {
    console.error(err);
    return res.status(200).json({
      success: false,
      total_units: 0,
      formatted_list: [],
      formatted_message:
        "Nagka-issue sa pagkuha ng units ngayon. Paki-try ulit in a bit o ibigay mo muna ang city, budget, at transmission para ma-priority ka.",
      images: []
    });
  }
}

function toEmoji(i) {
  return ["🚗", "🚙", "🚘"][i] || "🚗";
}
