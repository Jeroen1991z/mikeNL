// Dutch case law and legislation API client.
// rechtspraak.nl open data: no authentication required, max 10 req/sec.
// wetten.overheid.nl: SRU search endpoint, no authentication required.
// repository.overheid.nl/sru: SGD (Staten-Generaal Digitaal) for Memorie van Toelichting.

const RECHTSPRAAK_BASE = "https://data.rechtspraak.nl/uitspraken";
const WETTEN_SRU_BASE = "https://zoekservice.overheid.nl/sru/Search";
const OVERHEID_SRU_BASE = "https://repository.overheid.nl/sru";

export interface CaseLawResult {
    ecli: string;
    title: string;
    court: string;
    date: string;
    summary: string;
    url: string;
}

export interface CaseLawDetail {
    ecli: string;
    title: string;
    court: string;
    date: string;
    text: string;
    url: string;
}

export interface LegislationResult {
    bwb_id: string;
    title: string;
    url: string;
    snippet: string;
    xml_url?: string;  // latest version XML for fetching article text
}

// ---------------------------------------------------------------------------
// XML helpers (no external deps)
// ---------------------------------------------------------------------------

function extractTag(xml: string, tag: string): string {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i");
    const m = xml.match(re);
    return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

function extractAllEntries(xml: string): string[] {
    const entries: string[] = [];
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        entries.push(m[1]);
    }
    return entries;
}

function decodeXml(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n: string) =>
            String.fromCharCode(parseInt(n, 10)),
        );
}

function stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Infer a human-readable court name from the ECLI code segment.
function inferCourt(ecli: string): string {
    const parts = ecli.split(":");
    const code = parts[2] ?? "";
    const map: Record<string, string> = {
        HR: "Hoge Raad",
        RVS: "Raad van State",
        CRVB: "Centrale Raad van Beroep",
        CBB: "College van Beroep voor het bedrijfsleven",
        GHAMS: "Gerechtshof Amsterdam",
        GHDHA: "Gerechtshof Den Haag",
        GHSHE: "Gerechtshof 's-Hertogenbosch",
        GHARL: "Gerechtshof Arnhem-Leeuwarden",
        RBAMS: "Rechtbank Amsterdam",
        RBDHA: "Rechtbank Den Haag",
        RBNHO: "Rechtbank Noord-Holland",
        RBZWB: "Rechtbank Zeeland-West-Brabant",
        RBMNE: "Rechtbank Midden-Nederland",
        RBLIM: "Rechtbank Limburg",
        RBOBR: "Rechtbank Oost-Brabant",
        RBGEL: "Rechtbank Gelderland",
        RBOVE: "Rechtbank Overijssel",
        RBNNE: "Rechtbank Noord-Nederland",
        RBROT: "Rechtbank Rotterdam",
    };
    return map[code] ?? (code ? `Rechtbank/Gerechtshof (${code})` : "Nederlandse rechter");
}

// ---------------------------------------------------------------------------
// Case law search — rechtspraak.nl ECLI index
// ---------------------------------------------------------------------------

export async function searchCaseLaw(
    query: string,
    options: { max?: number; dateFrom?: string } = {},
): Promise<CaseLawResult[]> {
    const max = Math.min(options.max ?? 10, 20);
    const params = new URLSearchParams({
        zoekterm: query,
        max: String(max),
        return: "DOC",
        sort: "DESC",
    });
    if (options.dateFrom) {
        params.set("modified", `${options.dateFrom}T00:00:00`);
    }

    const url = `${RECHTSPRAAK_BASE}/zoeken?${params.toString()}`;
    const resp = await fetch(url, {
        headers: { Accept: "application/atom+xml, application/xml, */*" },
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
        throw new Error(`rechtspraak.nl search failed: HTTP ${resp.status}`);
    }

    const xml = await resp.text();
    const entries = extractAllEntries(xml);

    return entries
        .map((entry): CaseLawResult | null => {
            const ecli = decodeXml(extractTag(entry, "id")).trim();
            if (!ecli.startsWith("ECLI:")) return null;

            const title = decodeXml(extractTag(entry, "title")) || ecli;
            const summary = decodeXml(extractTag(entry, "summary")).slice(0, 800);
            const updated = extractTag(entry, "updated").slice(0, 10);

            const authorMatch = entry.match(
                /<author[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/i,
            );
            const court = authorMatch
                ? decodeXml(authorMatch[1].trim())
                : inferCourt(ecli);

            const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i);
            const contentUrl = linkMatch
                ? linkMatch[1]
                : `${RECHTSPRAAK_BASE}/content?id=${encodeURIComponent(ecli)}`;

            return { ecli, title, court, date: updated, summary, url: contentUrl };
        })
        .filter((r): r is CaseLawResult => r !== null);
}

// ---------------------------------------------------------------------------
// Case law full-text fetch
// ---------------------------------------------------------------------------

export async function fetchCaseLaw(ecli: string): Promise<CaseLawDetail> {
    const url = `${RECHTSPRAAK_BASE}/content?id=${encodeURIComponent(ecli)}`;
    const resp = await fetch(url, {
        headers: { Accept: "application/xml, */*" },
        signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
        throw new Error(`rechtspraak.nl content fetch failed: HTTP ${resp.status}`);
    }

    const xml = await resp.text();

    const title = decodeXml(
        extractTag(xml, "dcterms:title") || extractTag(xml, "title"),
    );
    const date = (extractTag(xml, "dcterms:date") || extractTag(xml, "date")).slice(0, 10);
    const creator = decodeXml(
        extractTag(xml, "dcterms:creator") || extractTag(xml, "creator"),
    );
    const court = creator || inferCourt(ecli);

    // Extract body: prefer <uitspraak> or <conclusie>, fall back to full doc.
    const bodyMatch =
        xml.match(/<uitspraak>([\s\S]*?)<\/uitspraak>/i) ??
        xml.match(/<conclusie>([\s\S]*?)<\/conclusie>/i);
    const rawBody = bodyMatch ? bodyMatch[1] : xml;

    // Strip XML tags, normalise whitespace, cap length to avoid overloading context.
    const text = stripTags(rawBody).slice(0, 15_000);

    const viewUrl = `https://uitspraken.rechtspraak.nl/details?id=${encodeURIComponent(ecli)}`;
    return { ecli, title, court, date, text, url: viewUrl };
}

// ---------------------------------------------------------------------------
// Legislation search — wetten.overheid.nl via SRU
// ---------------------------------------------------------------------------

export async function searchLegislation(
    query: string,
    options: { max?: number } = {},
): Promise<LegislationResult[]> {
    const max = Math.min(options.max ?? 5, 10);
    const params = new URLSearchParams({
        operation: "searchRetrieve",
        version: "1.2",
        "x-connection": "BWB",
        query: `overheidbwb.titel any "${query}"`,
        maximumRecords: String(max),
    });

    const url = `${WETTEN_SRU_BASE}?${params.toString()}`;
    const resp = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
        throw new Error(`wetten.overheid.nl search failed: HTTP ${resp.status}`);
    }

    const xml = await resp.text();
    const results: LegislationResult[] = [];

    // Collect all records per BWB ID, keeping metadata from first occurrence
    // but updating xml_url to the latest version (highest geldigheidsperiode_startdatum).
    const byBwbId = new Map<string, {
        title: string; snippet: string;
        latestDate: string; xml_url: string;
    }>();

    const recordRe = /<record[^>]*>([\s\S]*?)<\/record>/g;
    let m: RegExpExecArray | null;
    while ((m = recordRe.exec(xml)) !== null) {
        const record = m[1];
        const title = decodeXml(extractTag(record, "dcterms:title"));
        if (!title) continue;

        const identifier = decodeXml(extractTag(record, "dcterms:identifier"));
        const bwbMatch = identifier.match(/BWBR\d+/);
        const bwb_id = bwbMatch ? bwbMatch[0] : "";
        if (!bwb_id) continue;

        const rechtsgebiedMatches: string[] = [];
        const rgRe = /<overheidbwb:rechtsgebied[^>]*>([\s\S]*?)<\/overheidbwb:rechtsgebied>/g;
        let rgm: RegExpExecArray | null;
        while ((rgm = rgRe.exec(record)) !== null) {
            rechtsgebiedMatches.push(decodeXml(rgm[1].trim()));
        }
        const snippet = rechtsgebiedMatches.join("; ");
        const startDate = extractTag(record, "overheidbwb:geldigheidsperiode_startdatum").slice(0, 10);
        const xmlUrl = extractTag(record, "overheidbwb:locatie_toestand");

        const existing = byBwbId.get(bwb_id);
        if (!existing) {
            byBwbId.set(bwb_id, { title, snippet, latestDate: startDate, xml_url: xmlUrl });
        } else if (startDate > existing.latestDate && xmlUrl) {
            existing.latestDate = startDate;
            existing.xml_url = xmlUrl;
        }
    }

    for (const [bwb_id, { title, snippet, xml_url }] of byBwbId) {
        const wetsUrl = `https://wetten.overheid.nl/${bwb_id}`;
        results.push({ bwb_id, title, url: wetsUrl, snippet, xml_url: xml_url || undefined });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Legislation full-text fetch — BWB XML article extraction
// ---------------------------------------------------------------------------

export async function fetchLegislationArticle(
    bwb_id: string,
    article_number: string,
    xml_url?: string,
): Promise<{ bwb_id: string; article: string; text: string; url: string }> {
    // Try manifest to get latest version XML URL
    let targetUrl = xml_url ?? "";
    if (!targetUrl) {
        const manifestUrl = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwb_id}/manifest.xml`;
        try {
            const mResp = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
            if (mResp.ok) {
                const mXml = await mResp.text();
                // Find entries with einddatum 9999 (currently valid) and pick the latest
                const entries: { date: string; file: string }[] = [];
                const entryRe = /<ns2:Uitwisselingsbestand[^>]*>([\s\S]*?)<\/ns2:Uitwisselingsbestand>/g;
                let em: RegExpExecArray | null;
                while ((em = entryRe.exec(mXml)) !== null) {
                    const entry = em[1];
                    const eind = extractTag(entry, "ns2:GeldigTot") || extractTag(entry, "GeldigTot");
                    if (!eind.startsWith("9999")) continue;
                    const vanaf = extractTag(entry, "ns2:GeldigVanaf") || extractTag(entry, "GeldigVanaf");
                    const naam = extractTag(entry, "ns2:Naam") || extractTag(entry, "Naam");
                    if (naam) entries.push({ date: vanaf, file: naam });
                }
                if (entries.length > 0) {
                    entries.sort((a, b) => b.date.localeCompare(a.date));
                    const file = entries[0].file;
                    const dateKey = file.replace(`${bwb_id}_`, "").replace(".xml", "");
                    targetUrl = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwb_id}/${dateKey}/xml/${file}`;
                }
            }
        } catch {
            // fall through to wetten.overheid.nl approach
        }
    }

    // Fetch the XML (or fall back to wetten.overheid.nl HTML)
    let lawText = "";
    if (targetUrl) {
        try {
            const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(20_000) });
            if (resp.ok) lawText = await resp.text();
        } catch {
            // fall through
        }
    }
    if (!lawText) {
        const today = new Date().toISOString().slice(0, 10);
        const htmlResp = await fetch(`https://wetten.overheid.nl/${bwb_id}/${today}`, {
            signal: AbortSignal.timeout(20_000),
        });
        if (!htmlResp.ok) throw new Error(`Could not fetch ${bwb_id}: HTTP ${htmlResp.status}`);
        lawText = await htmlResp.text();
    }

    // Strip tags to plain text for article extraction
    const plain = stripTags(lawText).replace(/\s+/g, " ");

    // Search for the article by number
    const patterns = [
        new RegExp(`Artikel\\s+${article_number}\\b([\\s\\S]{0,4000})`, "i"),
        new RegExp(`Art\\.\\s*${article_number}\\b([\\s\\S]{0,4000})`, "i"),
    ];
    for (const re of patterns) {
        const match = plain.match(re);
        if (match) {
            // Trim at next article boundary
            const raw = match[1];
            const nextArticle = raw.search(/\bArtikel\s+\d/i);
            const articleText = nextArticle > 100 ? raw.slice(0, nextArticle).trim() : raw.trim();
            return {
                bwb_id,
                article: article_number,
                text: `Artikel ${article_number}\n${articleText.slice(0, 3000)}`,
                url: `https://wetten.overheid.nl/${bwb_id}#Artikel${article_number}`,
            };
        }
    }

    throw new Error(`Artikel ${article_number} niet gevonden in ${bwb_id}`);
}

// ---------------------------------------------------------------------------
// Memorie van Toelichting — Staten-Generaal Digitaal (SGD)
// ---------------------------------------------------------------------------

export interface MvTResult {
    title: string;
    dossiernummer?: string;
    date?: string;
    url: string;
    snippet: string;
}

export async function searchMvT(
    query: string,
    options: { max?: number } = {},
): Promise<MvTResult[]> {
    const max = Math.min(options.max ?? 5, 10);
    const params = new URLSearchParams({
        operation: "searchRetrieve",
        version: "1.2",
        "x-connection": "sgd",
        query: `(dt.title any "${query}" OR dt.abstract any "${query}") AND c.product-area=sgd`,
        maximumRecords: String(max),
    });

    const url = `${OVERHEID_SRU_BASE}?${params.toString()}`;
    const resp = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
        throw new Error(`Memorie van Toelichting search failed: HTTP ${resp.status}`);
    }

    const xml = await resp.text();
    const results: MvTResult[] = [];

    const recordRe = /<record[^>]*>([\s\S]*?)<\/record>/g;
    let m: RegExpExecArray | null;
    while ((m = recordRe.exec(xml)) !== null) {
        const record = m[1];
        const title = decodeXml(
            extractTag(record, "dt:title") || extractTag(record, "dcterms:title"),
        );
        if (!title) continue;

        const identifier = decodeXml(
            extractTag(record, "dt:identifier") || extractTag(record, "dcterms:identifier"),
        );
        const snippet = decodeXml(
            (extractTag(record, "dt:abstract") || extractTag(record, "dcterms:abstract")).slice(0, 400),
        );
        const date = (
            extractTag(record, "dt:date") ||
            extractTag(record, "dt:issued") ||
            extractTag(record, "dcterms:date")
        ).slice(0, 10);
        const dossiernummer = extractTag(record, "w:dossiernummer");

        results.push({
            title,
            dossiernummer: dossiernummer || undefined,
            date: date || undefined,
            url: identifier || "https://www.officielebekendmakingen.nl/",
            snippet,
        });
    }

    return results;
}
