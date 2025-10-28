export default async function handler(req, res) {
  const { query } = req;

  // Replace with your deployed Apps Script Web App URL
  const SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbzHYR88kI1I8Lwva3_1ncegrRndpFBooOaXEI8sSYCMGNTtAeWxRyzbwMDjNhtSJRFU/exec";

  try {
    const response = await fetch(SHEETS_API_URL);
    const data = await response.json();

    // optional filter: prioritize "Priority" units first
    const sorted = data.items.sort((a, b) => {
      if (a.price_status === "Priority" && b.price_status !== "Priority") return -1;
      if (b.price_status === "Priority" && a.price_status !== "Priority") return 1;
      return 0;
    });

    res.status(200).json({
      success: true,
      total_units: sorted.length,
      sample_units: sorted.slice(0, 3), // return first 3 for testing
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
