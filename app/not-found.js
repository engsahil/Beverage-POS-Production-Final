import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-cream px-4">
      <div className="text-center">
        <div className="text-4xl font-semibold text-stone-300">404</div>
        <h1 className="mt-2 text-lg font-semibold text-stone-900">Page not found</h1>
        <Link href="/" className="mt-4 inline-block rounded-md bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
