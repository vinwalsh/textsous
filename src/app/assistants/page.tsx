import type { Metadata } from "next";
import Link from "next/link";
import CopyButton from "./CopyButton";
import styles from "./assistants.module.css";
import {
  MUSE_URL,
  TEXTSOUS_ASSISTANTS_URL,
  TEXTSOUS_MCP_URL,
  assistantPrompt,
  promptRecipeUrl,
} from "./content";

export const metadata: Metadata = {
  title: "Use TextSous in your AI assistant",
  description:
    "Connect TextSous to Muse, ChatGPT, Claude or Gemini and turn any recipe into a cook along in the assistant you already use.",
};

export default async function AssistantsPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const params = await searchParams;
  const recipeUrl = promptRecipeUrl(params.url);
  const prompt = recipeUrl ? assistantPrompt(recipeUrl) : null;

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>TextSous in your AI assistant</p>
      <h1 className={styles.title}>Keep cooking in the assistant you already use</h1>
      <p className={styles.lead}>
        Your AI assistant does the conversion with its own model, so it is not limited by this
        site&apos;s daily free conversions. The result opens here on open.textsous.com and saves
        to your TextSous Cookbook.
      </p>
      <p className={styles.note}>
        You need a free TextSous account. Your assistant asks you to sign in the first time.
      </p>

      {prompt ? (
        <section className={`${styles.card} ${styles.promptCard}`} aria-labelledby="prompt-heading">
          <h2 id="prompt-heading" className={styles.cardTitle}>
            Your recipe, ready to send
          </h2>
          <p className={styles.small}>Once TextSous is connected, paste this into your assistant:</p>
          <p className={styles.prompt}>{prompt}</p>
          <CopyButton text={prompt} label="Copy prompt" />
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="muse-heading">
        <h2 id="muse-heading" className={styles.cardTitle}>
          Connect Muse
        </h2>
        <p className={styles.small}>
          Muse is Meta&apos;s personal agent at <a href={MUSE_URL}>muse.ai</a>. You add TextSous
          to it from a Muse chat.
        </p>
        <ol className={styles.steps}>
          <li>
            Open <a href={MUSE_URL}>muse.ai</a> and sign in.
          </li>
          <li>
            In a chat, ask Muse to create a custom connector for TextSous at this address:
            <span className={styles.address}>
              <code className={styles.code}>{TEXTSOUS_MCP_URL}</code>
              <CopyButton text={TEXTSOUS_MCP_URL} label="Copy address" />
            </span>
          </li>
          <li>Sign in with your free TextSous account when Muse asks (or create one there).</li>
          <li>
            Ask Muse to turn a recipe into a cook along: send a link, paste the text, or share a
            photo. For a photo, Muse reads it and checks the words with you before saving.
          </li>
        </ol>
        <p className={styles.small}>
          Muse asking something different? <a href={TEXTSOUS_ASSISTANTS_URL}>Steps for Muse</a> on
          textsous.com stay up to date.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="others-heading">
        <h2 id="others-heading" className={styles.cardTitle}>
          ChatGPT, Claude and Gemini
        </h2>
        <p className={styles.small}>
          Each connects to the same address, <code className={styles.inlineCode}>{TEXTSOUS_MCP_URL}</code>,
          and asks you to sign in to TextSous.
        </p>
        <ul className={styles.others}>
          <li>
            <strong>ChatGPT:</strong> add TextSous as a connector.{" "}
            <a href={TEXTSOUS_ASSISTANTS_URL}>Steps for ChatGPT</a>
          </li>
          <li>
            <strong>Claude:</strong> add TextSous as a custom connector.{" "}
            <a href={TEXTSOUS_ASSISTANTS_URL}>Steps for Claude</a>
          </li>
          <li>
            <strong>Gemini:</strong> add TextSous as a connector.{" "}
            <a href={TEXTSOUS_ASSISTANTS_URL}>Steps for Gemini</a>
          </li>
        </ul>
      </section>

      <section className={styles.card} aria-labelledby="how-heading">
        <h2 id="how-heading" className={styles.cardTitle}>
          How it works
        </h2>
        <ol className={styles.steps}>
          <li>You send a recipe link, pasted text or a photo to your assistant.</li>
          <li>Your assistant reads it and writes the cook along with its own model, following the TextSous format.</li>
          <li>TextSous checks the steps, builds the timeline and saves it, with credit to the original recipe.</li>
          <li>You get a link that opens here, and a copy in your TextSous Cookbook.</li>
        </ol>
      </section>

      <p className={styles.back}>
        <Link href="/">Back to the converter</Link>
      </p>
    </main>
  );
}
