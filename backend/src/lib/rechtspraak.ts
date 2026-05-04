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

    const recordRe = /<record[^>]*>([\s\S]*?)<\/record>/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = recordRe.exec(xml)) !== null) {
        const record = m[1];
        const title = decodeXml(extractTag(record, "dcterms:title"));
        if (!title) continue;

        const identifier = decodeXml(extractTag(record, "dcterms:identifier"));

        // Use legal domain as snippet since BWB records have no description
        const rechtsgebiedMatches: string[] = [];
        const rgRe = /<overheidbwb:rechtsgebied[^>]*>([\s\S]*?)<\/overheidbwb:rechtsgebied>/g;
        let rgm: RegExpExecArray | null;
        while ((rgm = rgRe.exec(record)) !== null) {
            rechtsgebiedMatches.push(decodeXml(rgm[1].trim()));
        }
        const snippet = rechtsgebiedMatches.join("; ");

        const bwbMatch = identifier.match(/BWBR\d+/);
        const bwb_id = bwbMatch ? bwbMatch[0] : "";
        if (!bwb_id || seen.has(bwb_id)) continue; // deduplicate versions
        seen.add(bwb_id);

        const wetsUrl = `https://wetten.overheid.nl/${bwb_id}`;
        results.push({ bwb_id, title, url: wetsUrl, snippet });
    }

    return results;
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
