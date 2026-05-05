import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Use – MikeNL",
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-white px-6 py-16 font-sans text-gray-800">
            <div className="mx-auto max-w-2xl">
                <Link href="/signup" className="mb-10 inline-block text-sm text-blue-600 hover:underline">
                    ← Back
                </Link>

                <h1 className="mb-2 font-serif text-3xl font-light">Terms of Use</h1>
                <p className="mb-10 text-sm text-gray-400">Last updated: coming soon</p>

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                    These Terms of Use are currently being drafted. Please check back later.
                </div>

                <div className="mt-10 space-y-6 text-sm leading-relaxed text-gray-600">
                    <p>
                        MikeNL is an AI-powered legal assistant platform. By using this service
                        you agree to use it responsibly and in accordance with applicable law.
                    </p>
                    <p>
                        Full terms of use will be published here in due course.
                    </p>
                </div>
            </div>
        </div>
    );
}
