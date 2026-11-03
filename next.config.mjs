const dev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: scripts only from this site. 'unsafe-inline' is needed for Next.js's inline
// bootstrap scripts; 'wasm-unsafe-eval' for the WebAssembly engines (PDF.js decoders, MuPDF, Tesseract).
// https: in connect-src / img-src lets the viewer load files through signed storage links (e.g. R2).
const csp = (extraScript = "") =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}${extraScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' blob: data: https:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Native / WASM processing libraries are loaded by Node directly rather than bundled.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "nodemailer", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "mupdf", "sharp", "tesseract.js", "archiver", "busboy", "pdf-lib", "@pdf-lib/fontkit", "docx", "@anthropic-ai/sdk"],
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      // browsers only honour this over HTTPS, so it is harmless on localhost
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/((?!scanner/).*)", headers: [...common, { key: "Content-Security-Policy", value: csp() }] },
      // the scanner's vision worker runs OpenCV.js, whose generated bindings build functions at runtime
      { source: "/scanner/:path*", headers: [...common, { key: "Content-Security-Policy", value: csp(" 'unsafe-eval'") }] },
      // large vendor engines (OpenCV ~10 MB, OCR ~16 MB, PDF.js assets, fonts): cache for a week instead of re-checking on every visit
      ...["/opencv/:path*", "/tesseract/:path*", "/pdfjs/:path*", "/fonts/:path*", "/pdf.worker.min.mjs"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      })),
    ];
  },
};

export default nextConfig;
