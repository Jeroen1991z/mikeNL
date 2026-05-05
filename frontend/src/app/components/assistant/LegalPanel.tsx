"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { MikeCitationAnnotation } from "../shared/types";
import { fetchLegalCase, fetchLegalArticle } from "@/app/lib/mikeApi";

interface Props {
    citation: MikeCitationAnnotation;
}

/**
 * Find the start/end range of a quote in text.
 * Tries exact match, then case-insensitive, then splits on [...] markers and
 * finds the span from the first segment to the last.
 */
function findQuoteRange(text: string, quote: string): { start: number; end: number } | null {
    // 1. Exact match
    const exact = text.indexOf(quote);
    if (exact !== -1) return { start: exact, end: exact + quote.length };

    // 2. Case-insensitive
    const lower = text.toLowerCase();
    const ci = lower.indexOf(quote.toLowerCase());
    if (ci !== -1) return { start: ci, end: ci + quote.length };

    // 3. Split on [...] omission markers and find the span between segments
    const segments = quote
        .split(/\s*\[\.{2,3}\]\s*|\s*…\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 8);
    if (segments.length < 2) return null;

    const first = segments[0].toLowerCase();
    const last = segments[segments.length - 1].toLowerCase();

    const startIdx = lower.indexOf(first);
    if (startIdx === -1) return null;

    const endSearch = lower.indexOf(last, startIdx + first.length);
    if (endSearch === -1) return null;

    return { start: startIdx, end: endSearch + last.length };
}

export function LegalPanel({ citation }: Props) {
    const [fullText, setFullText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset state and auto-load legislation whenever the citation changes.
    // Legislation is auto-loaded here (inline async) to avoid stale-closure
    // issues with a separate effect that reads fullText/error from prior render.
    useEffect(() => {
        setFullText(null);
        setError(null);

        if (citation.type !== "legislation") {
            setLoading(false);
            return;
        }

        setLoading(true);
        let cancelled = false;

        const bwbMatch = citation.external_url?.match(/BWBR\d+/);
        const bwbId = bwbMatch?.[0];
        const articleNum =
            citation.article?.match(/[\d:]+(?:\s*lid\s*\d+)?/)?.[0]?.trim() ?? "";

        if (!bwbId || !articleNum) {
            setError("Onvoldoende gegevens om artikel op te halen");
            setLoading(false);
            return;
        }

        fetchLegalArticle(bwbId, articleNum, citation.xml_url)
            .then((detail) => {
                if (!cancelled) setFullText(detail.text);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(String(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [citation.ecli, citation.article, citation.type, citation.external_url, citation.xml_url]);

    // Scroll to the <mark> element after ReactMarkdown renders it
    useEffect(() => {
        if (!fullText) return;
        const timer = setTimeout(() => {
            const mark = containerRef.current?.querySelector("mark");
            mark?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 120);
        return () => clearTimeout(timer);
    }, [fullText]);

    // Manual load for case law (triggered by the button).
    const loadCaseLaw = async () => {
        if (!citation.ecli) return;
        setLoading(true);
        setError(null);
        try {
            const detail = await fetchLegalCase(citation.ecli);
            setFullText(detail.text);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // Find the range of the quote in the markdown text (supports [...] omissions)
    const matchRange = useMemo(() => {
        if (!fullText) return null;
        const quote = citation.quote?.trim();
        if (!quote || quote.length < 10) return null;
        return findQuoteRange(fullText, quote);
    }, [fullText, citation.quote]);

    const matchFound = fullText === null ? null : matchRange !== null;

    // Inject <mark> into the markdown string so rehype-raw renders it highlighted
    const markedText = useMemo(() => {
        if (!fullText || !matchRange) return fullText ?? "";
        const { start, end } = matchRange;
        return (
            fullText.slice(0, start) +
            `<mark class="bg-yellow-200 rounded px-0.5">${fullText.slice(start, end)}</mark>` +
            fullText.slice(end)
        );
    }, [fullText, matchRange]);

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

            {/* Quoted passage */}
            <div className="px-4 py-3 border-b border-gray-100 shrink-0 bg-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Geciteerde passage</p>
                <blockquote className="text-sm text-gray-700 leading-relaxed italic border-l-2 border-blue-300 pl-3">
                    &ldquo;{citation.quote}&rdquo;
                </blockquote>
            </div>

            {/* Full text area */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                {!fullText && !loading && !error && isCase && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                        <button
                            type="button"
                            onClick={loadCaseLaw}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                        >
                            {loadLabel}
                        </button>
                        <p className="text-xs text-gray-400">
                            Haalt tekst op van rechtspraak.nl
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
                            onClick={loadCaseLaw}
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
                        <div
                            ref={containerRef}
                            className="prose prose-sm max-w-none font-serif text-gray-800
                                prose-headings:font-sans prose-headings:font-semibold
                                prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3
                                prose-h3:text-sm prose-h3:mt-5 prose-h3:mb-1
                                prose-p:leading-relaxed prose-p:mb-4
                                prose-strong:font-semibold
                                prose-li:my-0.5"
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                            >
                                {markedText}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
