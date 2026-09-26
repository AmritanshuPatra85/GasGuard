import Link from "next/link";
import { signInDemo } from "./actions";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 text-center">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-text">GasGuard</h1>
        <p className="max-w-md text-sm text-muted">
          Real-time gas-leak detection and incident response for
          apartment societies — live device monitoring, automatic
          anomaly detection, and escalating alerts when it matters.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <form action={signInDemo}>
          <button
            type="submit"
            className="rounded-md bg-text px-4 py-2 text-sm font-medium text-background"
          >
            Enter Demo
          </button>
        </form>

        <Link
          href="/login"
          className="rounded-md border border-border px-4 py-2 text-sm text-text"
        >
          Sign In
        </Link>
      </div>
    </div>
  );
}
