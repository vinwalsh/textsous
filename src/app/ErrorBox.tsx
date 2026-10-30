import type { FriendlyError } from "./request";

export default function ErrorBox({ error }: { error: FriendlyError }) {
  return (
    <p role="alert" className="alert">
      <strong>{error.title}.</strong> {error.detail}
    </p>
  );
}
