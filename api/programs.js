import { programs, allPrograms } from "../lib/kb.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  // ?all=1 returns the full unfiltered catalog (used by /all/). Anything
  // else returns the currently allowlisted set.
  const showAll = req.query?.all === "1" || req.query?.all === "true";
  res.status(200).json(showAll ? allPrograms : programs);
}
