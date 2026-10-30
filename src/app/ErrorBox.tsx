import type { FriendlyError } from "./request";

export default function ErrorBox({
  error,
  onAction,
}: {
  error: FriendlyError;
  onAction?: () => void;
}) {
  return (
    <div role="alert" className="alert">
      <p style={{ margin: 0 }}>
        <strong>{error.title}.</strong> {error.detail}
      </p>
      {error.action === "paste-text" && onAction ? (
        <div className="btn-row">
          <button type="button" className="btn" onClick={onAction}>
            Paste the recipe text instead
          </button>
        </div>
      ) : null}
    </div>
  );
}
