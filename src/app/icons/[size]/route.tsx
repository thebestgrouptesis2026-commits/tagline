import { renderAppIcon } from "@/components/app-icon";

const SIZES: Record<string, { size: number; inset: number }> = {
  "192": { size: 192, inset: 0.18 },
  "512": { size: 512, inset: 0.18 },
  maskable: { size: 512, inset: 0.26 },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await params).size];
  if (!spec) return new Response("Not found", { status: 404 });
  return renderAppIcon(spec.size, spec.inset);
}
