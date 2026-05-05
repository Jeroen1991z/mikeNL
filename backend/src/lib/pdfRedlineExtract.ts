import { spawn } from "child_process";
import path from "path";

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/redline_extract.py");

export async function extractPdfRedlineMarkdown(buf: ArrayBuffer): Promise<string | null> {
    return new Promise((resolve) => {
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn(PYTHON_BIN, [SCRIPT_PATH], { stdio: ["pipe", "pipe", "pipe"] });
        } catch {
            return resolve(null);
        }

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let done = false;

        const finish = (result: string | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(result);
        };

        const timer = setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch { /* ignore */ }
            finish(null);
        }, 30_000);

        proc.stdout.on("data", (d: Buffer) => stdout.push(d));
        proc.stderr.on("data", (d: Buffer) => stderr.push(d));
        proc.on("error", () => finish(null));
        proc.on("close", (code) => {
            if (code !== 0) {
                const errText = Buffer.concat(stderr).toString("utf8").slice(0, 500);
                if (errText) console.error("[pdfRedlineExtract] stderr:", errText);
                return finish(null);
            }
            finish(Buffer.concat(stdout).toString("utf8"));
        });

        proc.stdin.write(Buffer.from(buf));
        proc.stdin.end();
    });
}
