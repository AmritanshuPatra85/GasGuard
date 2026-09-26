import { StatusBadge } from "./status-badge";

export function Header() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
      {/* Page title / breadcrumb slot — intentionally empty until nested
          Device/Incident detail routes exist to give it real content. */}
      <div />

      <div className="flex items-center gap-4">
        {/* TODO: wire to real Supabase Realtime connection state once
            auth/tenant context is in place. Hardcoded for now — this is
            NOT navigator.onLine, that's a different signal. */}
        <StatusBadge status="healthy" label="Connected" />

        {/* Reserved for user/society menu. Placeholder only — sized so the
            header's width doesn't shift when the real menu lands. */}
        <div
          aria-hidden="true"
          className="h-8 w-8 rounded-full border border-border bg-background"
        />
      </div>
    </header>
  );
}
