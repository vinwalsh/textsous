import { NextResponse } from "next/server";
import { dailyCap, ratePerHour } from "../../../lib/limits";
import { isContributorModel, resolveProvider } from "../../../lib/model";

export async function GET() {
  const config = resolveProvider("meta");
  const baseten = resolveProvider("baseten");
  const contributorModel = isContributorModel(config.model);
  const productionContributorError =
    process.env.NODE_ENV === "production" && contributorModel;
  const status = productionContributorError ? "error" : "ok";
  return NextResponse.json(
    {
      status,
      version: 1,
      provider: "meta",
      model: config.model,
      contributorModel,
      productionContributorError,
      hasApiKey: Boolean(process.env.MODEL_API_KEY?.trim()),
      baseten: {
        model: baseten.model,
        baseUrlConfigured: Boolean(
          process.env.BASETEN_BASE_URL?.trim() || process.env.MODEL_BASE_URL?.trim(),
        ),
        hasApiKey: Boolean(baseten.apiKey),
      },
      upstashConfigured: Boolean(
        process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
      ),
      dailyCap: dailyCap(),
      ratePerHour: ratePerHour(),
      // Whether the secrets are set (never their values): skills routes and
      // "Save to TextSous" need them.
      skillsConfigured: Boolean(process.env.SKILLS_API_SECRET?.trim()),
      signingConfigured: Boolean(process.env.ARTIFACT_SIGNING_SECRET?.trim()),
    },
    { status: productionContributorError ? 500 : 200 },
  );
}
