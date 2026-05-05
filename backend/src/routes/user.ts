import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { encryptApiKey } from "../lib/encryption";

export const userRouter = Router();

// POST /user/profile
userRouter.post("/profile", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db
    .from("user_profiles")
    .upsert(
      { user_id: userId },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (error) {
    console.error("[user/profile] upsert error:", error.message, error);
    return void res.status(500).json({ detail: error.message });
  }
  res.json({ ok: true });
});

// PUT /user/api-key — save an API key with encryption
userRouter.put("/api-key", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { provider, value } = req.body as { provider?: string; value?: string | null };
    if (provider !== "claude" && provider !== "gemini") {
        return void res.status(400).json({ detail: "provider must be 'claude' or 'gemini'" });
    }
    const dbField = provider === "claude" ? "claude_api_key" : "gemini_api_key";
    const normalized = value?.trim() ? value.trim() : null;
    const encrypted = normalized ? encryptApiKey(normalized) : null;
    const db = createServerSupabase();
    const { error } = await db
        .from("user_profiles")
        .update({ [dbField]: encrypted, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    if (error) {
        console.error("[user/api-key] update error:", error.message);
        return void res.status(500).json({ detail: error.message });
    }
    res.json({ ok: true });
});

// DELETE /user/account
userRouter.delete("/account", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string;
  const db = createServerSupabase();
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return void res.status(500).json({ detail: error.message });
  res.status(204).send();
});
