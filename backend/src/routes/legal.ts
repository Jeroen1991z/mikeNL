import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { fetchCaseLaw, fetchLegislationArticle } from "../lib/rechtspraak";

export const legalRouter = Router();

// GET /legal/case?ecli=ECLI:NL:HR:2020:1234
legalRouter.get("/case", requireAuth, async (req, res) => {
    const ecli = req.query.ecli as string;
    if (!ecli) return res.status(400).json({ error: "ecli required" });
    try {
        const detail = await fetchCaseLaw(ecli);
        res.json(detail);
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

// GET /legal/article?bwb_id=BWBR0005289&article=162&xml_url=...
legalRouter.get("/article", requireAuth, async (req, res) => {
    const { bwb_id, article, xml_url } = req.query as Record<string, string>;
    if (!bwb_id || !article) return res.status(400).json({ error: "bwb_id and article required" });
    try {
        const detail = await fetchLegislationArticle(bwb_id, article, xml_url);
        res.json(detail);
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
