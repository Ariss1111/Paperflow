// Product identity in one place so renaming the app is a one-line change (or NEXT_PUBLIC_APP_NAME).
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Pagelyt";
/** The public address (APP_URL, or the one Render assigns); used for absolute links in metadata, sitemap and robots.txt. */
export const SITE_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3210").replace(/\/+$/, "");
export const APP_TAGLINE = "Every page. In its place.";
export const APP_HEADLINE = "Everything you need for your documents.";
export const APP_DESCRIPTION = "Scan, edit, convert, sign and organize your documents. All in one place.";
