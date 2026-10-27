import { ImageResponse } from "next/og";
import { LOGO_SVG } from "./logo";

/**
 * Ícono PWA: lienzo casi negro, arco blanco, punto violeta.
 * `inset` = margen interior en fracción del lado (maskable necesita ~20% de zona segura).
 */
export function renderAppIcon(size: number, inset = 0.18) {
  const src = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG("#f7f9fa")).toString("base64")}`;
  const logo = Math.round(size * (1 - inset * 2));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#090909" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={logo} height={logo} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
