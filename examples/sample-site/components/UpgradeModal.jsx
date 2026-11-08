export function UpgradeModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-4 top-24 z-50 mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-slate-900">Confirm Workspace Upgrade</h3>
        <p className="mt-2 text-sm text-slate-600">
          Your team will immediately unlock automated Tailwind design tokens.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500">
            Confirm Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}
