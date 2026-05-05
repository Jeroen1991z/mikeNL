"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { MikeCitationAnnotation } from "../shared/types";
import { fetchLegalCase, fetchLegalArticle } from "@/app/lib/mikeApi";

interface Props {
    citation: MikeCitationAnnotation;
}

/** Find the index of `quote` in `text` (exact, then case-insensitive). Returns -1 if not found. */
function findQuoteIndex(text: string, quote: string): number {
    const idx = text.indexOf(quote);
    if (idx !== -1) return idx;
    return text.toLowerCase().indexOf(quote.toLowerCase());
}

export function LegalPanel({ citation }: Props) {
    const [fullText, setFullText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const highlightRef = useRef<HTMLSpanElement>(null);

    // Reset when citation changes
    useEffect(() => {
        setFullText(null);
        setLoading(false);
        setError(null);
    }, [citation.ecli, citation.article]);

    // Scroll to highlight after full text loads
    useEffect(() => {
        if (fullText && highlightRef.current) {
            highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [fullText]);

    const loadFullText = async () => {
        setLoading(true);
        setError(null);
        try {
            if (citation.type === "case_law" && citation.ecli) {
                const detail = await fetchLegalCase(citation.ecli);
                setFullText(detail.text);
            } else if (citation.type === "legislation") {
                // Extract bwb_id from external_url, e.g. https://wetten.overheid.nl/BWBR0005289/...
                const bwbMatch = citation.external_url?.match(/BWBR\d+/);
                const bwbId = bwbMatch?.[0];
                // Extract article number from citation.article, e.g. "art. 6:162 BW" -> "162" or from article field
                const articleNum = citation.article?.match(/[\d:]+(?:\s*lid\s*\d+)?/)?.[0]?.trim() ?? "";
                if (!bwbId || !articleNum) throw new Error("Onvoldoende gegevens om artikel op te halen");
                const detail = await fetchLegalArticle(bwbId, articleNum);
                setFullText(detail.text);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // Compute match position synchronously from fullText — no setState in render
    const matchInfo = useMemo(() => {
        if (!fullText) return null;
        const quote = citation.quote?.trim();
        if (!quote || quote.length < 10) return { idx: -1, quote: "" };
        const idx = findQuoteIndex(fullText, quote);
        return { idx, quote };
    }, [fullText, citation.quote]);

    // Derive matchFound from matchInfo for the notice banner
    const matchFound = matchInfo === null ? null : matchInfo.idx !== -1;

    // Build highlighted JSX
    const renderFullText = (text: string) => {
        if (!matchInfo || matchInfo.idx === -1 || !matchInfo.quote) {
            return <span className="whitespace-pre-wrap text-sm leading-relaxed">{text}</span>;
        }
        const { idx, quote } = matchInfo;
        return (
            <span className="whitespace-pre-wrap text-sm leading-relaxed">
                {text.slice(0, idx)}
                <span ref={highlightRef} className="bg-yellow-200 rounded px-0.5">
                    {text.slice(idx, idx + quote.length)}
                </span>
                {text.slice(idx + quote.length)}
            </span>
        );
    };

    const isCase = citation.type === "case_law";
    const label = isCase
        ? (citation.title ?? citation.ecli ?? "Uitspraak")
        : (citation.article ?? citation.title ?? "Wetsartikel");
    const loadLabel = isCase ? "Laad volledige uitspraak" : "Laad artikel";
    const externalUrl = citation.external_url;
    const locationLabel = citation.type === "case_law"
        ? (citation.ro ? `r.o. ${citation.ro}` : null)
        : (citation.article ?? null);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
                            {isCase ? "Uitspraak" : "Wetgeving"}
                        </p>
                        <p className="text-sm font-medium text-gray-900 leading-snug truncate">{label}</p>
                        {locationLabel && (
                            <p className="text-xs text-gray-500 mt-0.5">{locationLabel}</p>
                        )}
                    </div>
                    {externalUrl && (
                        <a
                            href={externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                            title="Open op website"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}
                </div>
            </div>

            {/* Quote section */}
            <div className="px-4 py-3 border-b border-gray-100 shrink-0 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Geciteerde passage</p>
                <blockquote className="text-sm text-gray-700 leading-relaxed italic border-l-2 border-blue-300 pl-3">
                    &ldquo;{citation.quote}&rdquo;
                </blockquote>
            </div>

            {/* Full text area */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                {!fullText && !loading && !error && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                        <button
                            type="button"
                            onClick={loadFullText}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                        >
                            {loadLabel}
                        </button>
                        <p className="text-xs text-gray-400">
                            Haalt tekst op van {isCase ? "rechtspraak.nl" : "wetten.overheid.nl"}
                        </p>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center h-full gap-2 text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Laden...</span>
                    </div>
                )}

                {error && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                        <p className="text-sm text-red-600">{error}</p>
                        <button
                            type="button"
                            onClick={loadFullText}
                            className="text-xs text-blue-600 hover:underline"
                        >
                            Opnieuw proberen
                        </button>
                    </div>
                )}

                {fullText && (
                    <div>
                        {matchFound === false && (
                            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                                Exacte passage niet gevonden in de tekst. De geciteerde passage staat hierboven.
                            </p>
                        )}
                        <div className="text-sm text-gray-800">
                            {renderFullText(fullText)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
