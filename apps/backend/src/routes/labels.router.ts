import { Router } from "express";
import QRCode from "qrcode";
import { requireUser } from "../lib/auth";
import { wrap } from "../lib/http";

export const labelsRouter = Router();

// Returns a scalable SVG QR code for the given text, used by the label print
// pages via <img src="/api/labels/qr?data=...">.
labelsRouter.get(
  "/qr",
  wrap(async (req, res) => {
    await requireUser(req);
    const data = typeof req.query.data === "string" ? req.query.data : null;
    if (!data) {
      res.status(400).send("missing data");
      return;
    }
    const svg = await QRCode.toString(data, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    });
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(svg);
  }),
);
