import { programs } from "../lib/kb.js";

export default function handler(_req, res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.status(200).json(programs);
}
