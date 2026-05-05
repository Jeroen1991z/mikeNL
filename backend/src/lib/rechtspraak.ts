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

// Convert rechtspraak.nl XML body to markdown-formatted text for display.
// Handles the ECLI open-data XML elements: <title>, <nr>, <al>, <para>,
// <section>, <paragraaf>, <emphasis>, <bold>, <listitem>, etc.
function xmlToMarkdown(xml: string): string {
    let s = xml;

    // Section headings — <title> becomes ##, nested <titel> inside <kop> becomes ###
    s = s.replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, (_, c) => {
        const t = decodeXml(stripTags(c)).trim();
        return t ? `\n\n## ${t}\n\n` : "";
    });
    s = s.replace(/<titel[^>]*>([\s\S]*?)<\/titel>/gi, (_, c) => {
        const t = decodeXml(stripTags(c)).trim();
        return t ? `\n\n### ${t}\n\n` : "";
    });

    // <nr> — rechtsoverweging numbers; emit bold prefix, no newline before text
    s = s.replace(/<nr[^>]*>([\s\S]*?)<\/nr>/gi, (_, c) => {
        const num = decodeXml(stripTags(c)).trim();
        return num ? `\n\n**${num}** ` : "\n\n";
    });

    // <al> (alinea) — main paragraph text element
    s = s.replace(/<\/al>/gi, "\n\n");
    s = s.replace(/<al[^>]*>/gi, "");

    // <para> wrappers — just ensure spacing
    s = s.replace(/<\/para>/gi, "\n\n");
    s = s.replace(/<para[^>]*>/gi, "");

    // Structural block elements — normalise to blank line
    const blockRe = /<\/?(section|paragraaf|uitspraakoverwegingen|procesverloop|rolnummer|aanhef|beslissing|ondertekening|noot|kop)[^>]*>/gi;
    s = s.replace(blockRe, "\n\n");

    // Inline formatting
    s = s.replace(/<emphasis[^>]*>([\s\S]*?)<\/emphasis>/gi, (_, c) => `*${c}*`);
    s = s.replace(/<(?:bold|b)[^>]*>([\s\S]*?)<\/(?:bold|b)>/gi, (_, c) => `**${c}**`);
    s = s.replace(/<(?:underline|u)[^>]*>([\s\S]*?)<\/(?:underline|u)>/gi, (_, c) => c);

    // Lists
    s = s.replace(/<listitem[^>]*>([\s\S]*?)<\/listitem>/gi, (_, c) => `\n- ${stripTags(c).trim()}`);
    s = s.replace(/<\/?(lijst|list)[^>]*>/gi, "\n\n");

    // Tables — flatten to pipe-separated text
    s = s.replace(/<entry[^>]*>([\s\S]*?)<\/entry>/gi, (_, c) => `${stripTags(c).trim()} | `);
    s = s.replace(/<row[^>]*>([\s\S]*?)<\/row>/gi, (_, c) => `${c.trim()}\n`);
    s = s.replace(/<\/?(table|tabel|colspec|tbody|thead|tgroup)[^>]*>/gi, "\n\n");

    // Footnotes — inline in parens
    s = s.replace(/<footnote[^>]*>([\s\S]*?)<\/footnote>/gi, (_, c) => `(${stripTags(c).trim()})`);

    // Strip all remaining tags
    s = s.replace(/<[^>]+>/g, "");

    // Decode XML entities
    s = decodeXml(s);

    // Normalise whitespace
    s = s.replace(/[ \t]+/g, " ");
    s = s.replace(/\n[ \t]+/g, "\n");
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");

    return s.trim();
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

export async function fetchCaseLaw(ecli: string, options: { display?: boolean } = {}): Promise<CaseLawDetail> {
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

    // Extract body: prefer <uitspraak> or <conclusie>. Tags may carry attributes.
    // Fall back to stripping known metadata blocks from the full document.
    const bodyMatch =
        xml.match(/<uitspraak[^>]*>([\s\S]*?)<\/uitspraak>/i) ??
        xml.match(/<conclusie[^>]*>([\s\S]*?)<\/conclusie>/i);
    let rawBody: string;
    if (bodyMatch) {
        rawBody = bodyMatch[1];
    } else {
        // Strip Dublin Core / OAI metadata elements before falling back
        rawBody = xml
            .replace(/<(?:dcterms?|oa)[^:]*:[^>]+>[\s\S]*?<\/(?:dcterms?|oa)[^:]*:[^>]+>/gi, "")
            .replace(/<(?:identifier|modified|creator|subject|publisher|language|format|type|source|rights|inhoudsindicatie)[^>]*>[\s\S]*?<\/(?:identifier|modified|creator|subject|publisher|language|format|type|source|rights|inhoudsindicatie)>/gi, "");
    }

    // For display: convert XML to markdown (preserving structure). For LLM: plain text, capped.
    const text = options.display
        ? xmlToMarkdown(rawBody).slice(0, 80_000)
        : stripTags(rawBody).slice(0, 15_000);

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

// Resolve the latest current XML URL for a BWB ID via the SRU search service.
// The identifier field stores a full URL so we use "any" (contains) rather than exact match.
async function resolveBwbXmlUrl(bwb_id: string): Promise<string> {
    // Try two query forms: the BWB-specific index and the Dublin Core identifier index
    const queries = [
        `overheidbwb.identifier any "${bwb_id}"`,
        `dcterms.identifier any "${bwb_id}"`,
    ];
    for (const query of queries) {
        try {
            const params = new URLSearchParams({
                operation: "searchRetrieve",
                version: "1.2",
                "x-connection": "BWB",
                query,
                maximumRecords: "10",
            });
            const resp = await fetch(`${WETTEN_SRU_BASE}?${params}`, {
                signal: AbortSignal.timeout(12_000),
            });
            if (!resp.ok) continue;
            const xml = await resp.text();

            // Pick the record matching our bwb_id with the latest startdatum
            let bestDate = "";
            let bestUrl = "";
            const recordRe = /<record[^>]*>([\s\S]*?)<\/record>/g;
            let m: RegExpExecArray | null;
            while ((m = recordRe.exec(xml)) !== null) {
                const rec = m[1];
                const identifier = extractTag(rec, "dcterms:identifier");
                if (!identifier.includes(bwb_id)) continue;
                const locatie = extractTag(rec, "overheidbwb:locatie_toestand");
                const startDate = extractTag(rec, "overheidbwb:geldigheidsperiode_startdatum").slice(0, 10);
                if (locatie && startDate > bestDate) {
                    bestDate = startDate;
                    bestUrl = locatie;
                }
            }
            if (bestUrl) return bestUrl;
        } catch {
            // try next query
        }
    }
    throw new Error(`Geen actuele XML gevonden voor ${bwb_id}`);
}

export async function fetchLegislationArticle(
    bwb_id: string,
    article_number: string,
    xml_url?: string,
): Promise<{ bwb_id: string; article: string; text: string; url: string; xml_url: string }> {
    // Resolve XML URL: use provided url, then SRU lookup, then manifest as last resort
    let targetUrl = xml_url ?? "";
    let resolveError = "";

    if (!targetUrl) {
        try {
            targetUrl = await resolveBwbXmlUrl(bwb_id);
        } catch (e) {
            resolveError += `SRU: ${e}; `;
        }
    }

    if (!targetUrl) {
        const manifestUrl = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwb_id}/manifest.xml`;
        try {
            const mResp = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
            if (!mResp.ok) {
                resolveError += `manifest HTTP ${mResp.status}; `;
            } else {
                const mXml = await mResp.text();
                // The manifest XML structure varies; instead of parsing elements,
                // extract all repository XML URLs for this bwb_id and pick the latest by date.
                const today = new Date().toISOString().slice(0, 10);
                const urlPat = new RegExp(
                    `https://repository\\.officiele-overheidspublicaties\\.nl/bwb/${bwb_id}/(\\d{4}-\\d{2}-\\d{2})/xml/[^"<\\s]+\\.xml`,
                    "g",
                );
                const candidates: { date: string; url: string }[] = [];
                let um: RegExpExecArray | null;
                while ((um = urlPat.exec(mXml)) !== null) {
                    if (um[1] <= today) candidates.push({ date: um[1], url: um[0] });
                }
                if (candidates.length === 0) {
                    resolveError += `manifest: no XML URLs found; `;
                } else {
                    candidates.sort((a, b) => b.date.localeCompare(a.date));
                    targetUrl = candidates[0].url;
                }
            }
        } catch (e) {
            resolveError += `manifest fetch error: ${e}; `;
        }
    }

    // Fetch the XML
    let lawText = "";
    if (targetUrl) {
        try {
            const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(20_000) });
            if (resp.ok) {
                lawText = await resp.text();
            } else {
                resolveError += `XML fetch HTTP ${resp.status} from ${targetUrl}; `;
            }
        } catch (e) {
            resolveError += `XML fetch error: ${e}; `;
        }
    }
    if (!lawText) {
        console.error(`[fetchLegislationArticle] ${bwb_id}: ${resolveError}`);
        throw new Error(`Kon ${bwb_id} niet ophalen (${resolveError.slice(0, 200)})`);
    }

    // Strip tags to plain text for article extraction
    const plain = stripTags(lawText).replace(/\s+/g, " ");

    // Handle book:article format (e.g. "6:162" → also try "162")
    const baseNum = article_number.includes(":") ? article_number.split(":").pop()! : article_number;
    const numsToTry = article_number !== baseNum ? [article_number, baseNum] : [article_number];

    const patterns = numsToTry.flatMap((num) => [
        new RegExp(`Artikel\\s+${num}\\b([\\s\\S]{0,4000})`, "i"),
        new RegExp(`Art\\.\\s*${num}\\b([\\s\\S]{0,4000})`, "i"),
    ]);

    for (const re of patterns) {
        const match = plain.match(re);
        if (match) {
            // Trim at next article boundary
            const raw = match[1];
            const nextArticle = raw.search(/\bArtikel\s+\d/i);
            const articleText = nextArticle > 100 ? raw.slice(0, nextArticle).trim() : raw.trim();
            const today = new Date().toISOString().slice(0, 10);
            return {
                bwb_id,
                article: article_number,
                text: `Artikel ${article_number}\n${articleText.slice(0, 3000)}`,
                url: `https://wetten.overheid.nl/${bwb_id}/${today}#Artikel${baseNum}`,
                xml_url: targetUrl,
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
