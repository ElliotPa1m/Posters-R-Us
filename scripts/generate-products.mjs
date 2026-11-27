// Genererar en Shopify-produkt-CSV från en mapp med affischer (Filmnamn.jpg).
//
// Steg 1 (förbered bilder):
//   node scripts/generate-products.mjs "C:\sökväg\till\affischer"
//   -> kopierar bilderna till scripts/out/images med URL-säkra namn (back-to-the-future.jpg)
//
// Steg 2 (efter uppladdning till Innehåll -> Filer i Shopify):
//   node scripts/generate-products.mjs "C:\sökväg\till\affischer" "https://cdn.shopify.com/s/files/1/XXXX/XXXX/files/"
//   -> skriver scripts/out/products.csv som importeras under Produkter -> Importera

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "out");
const IMG_OUT_DIR = path.join(OUT_DIR, "images");

const VENDOR = "Posters R Us";
const PRODUCT_TYPE = "Poster";
const DEFAULT_STOCK = 25;

const SIZES = [
  { name: "A3", code: "A3", price: 199 },
  { name: "50x70 cm", code: "5070", price: 299 },
  { name: "70x100 cm", code: "70100", price: 449 },
];

const FRAMES = [
  { name: "Ingen ram", code: "U", extra: 0 },
  { name: "Med ram", code: "R", extra: 50 },
];

// Filmserier -> taggas som "serie:<slug>" så att paket/collections kan byggas senare.
// Matchningen sker på titeln (gemener). Lägg till fler serier här vid behov.
const FRANCHISES = {
  "star-wars": [
    "phantom menace", "attack of the clones", "revenge of the sith",
    "a new hope", "empire strikes back", "return of the jedi",
  ],
  "back-to-the-future": ["back to the future"],
  "dune": ["dune part", /^dune$/, "dune 1984"],
  "alien": [/^alien$/, /^aliens$/, "alien 3", "alien resurrection"],
  "avengers": ["avengers", "endgame", "infinity war", "age of ultron", "doomsday"],
  "spider-verse": ["into the spider-verse", "across the spider-verse", "beyond the spider-verse"],
  "lord-of-the-rings": ["fellowship of the ring", "two towers", "return of the king"],
  "the-dark-knight": ["batman begins", "dark knight"],
  "the-hobbit": ["hobbit", "unexpected journey", "desolation of smaug", "five armies"],
  "indiana-jones": [
    "indiana jones", "raiders of the lost ark", "temple of doom",
    "last crusade", "crystal skull", "dial of destiny",
  ],
  "terminator": ["terminator", "judgment day", "judgement day", "rise of the machines", "genisys", "dark fate"],
  "the-godfather": ["godfather"],
  "matrix": ["matrix"],
};

function slugify(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function franchiseTags(title) {
  const t = title.toLowerCase();
  const tags = [];
  for (const [slug, patterns] of Object.entries(FRANCHISES)) {
    const hit = patterns.some((p) => (p instanceof RegExp ? p.test(t) : t.includes(p)));
    if (hit) tags.push(`serie:${slug}`);
  }
  return tags;
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
  "Variant SKU", "Variant Inventory Tracker", "Variant Inventory Qty",
  "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price",
  "Variant Requires Shipping", "Variant Taxable",
  "Image Src", "Image Position", "Image Alt Text", "Status",
];

function main() {
  const [, , srcDir, cdnBase] = process.argv;
  if (!srcDir) {
    console.error('Användning: node scripts/generate-products.mjs "<bildmapp>" ["<cdn-bas-url>"]');
    process.exit(1);
  }

  const files = fs
    .readdirSync(srcDir)
    .filter((f) => /\.(jpe?g)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "sv"));

  if (files.length === 0) {
    console.error(`Hittade inga .jpg-filer i ${srcDir}`);
    process.exit(1);
  }

  const seen = new Set();
  const products = files.map((file) => {
    const title = path.parse(file).name.trim();
    const handle = slugify(title);
    if (seen.has(handle)) throw new Error(`Dubblett-handle "${handle}" (från ${file})`);
    seen.add(handle);
    return { file, title, handle, imageName: `${handle}.jpg`, tags: franchiseTags(title) };
  });

  // Steg 1: kopiera bilder med säkra filnamn
  fs.mkdirSync(IMG_OUT_DIR, { recursive: true });
  for (const p of products) {
    fs.copyFileSync(path.join(srcDir, p.file), path.join(IMG_OUT_DIR, p.imageName));
  }
  console.log(`✔ ${products.length} bilder kopierade till ${IMG_OUT_DIR}`);

  if (!cdnBase) {
    console.log("\nNästa steg:");
    console.log("  1. Ladda upp alla bilder i scripts/out/images under Innehåll -> Filer i Shopify.");
    console.log("  2. Kopiera länken till en av filerna och ta allt fram till och med /files/");
    console.log('  3. Kör scriptet igen med den som andra argument, t.ex. "https://cdn.shopify.com/s/files/1/XXXX/XXXX/files/"');
    return;
  }

  // Steg 2: skriv CSV
  const base = cdnBase.endsWith("/") ? cdnBase : `${cdnBase}/`;
  const rows = [HEADERS];

  for (const p of products) {
    let first = true;
    for (const size of SIZES) {
      for (const frame of FRAMES) {
        const sku = `${p.handle}-${size.code}-${frame.code}`.toUpperCase();
        rows.push([
          p.handle,
          first ? p.title : "",
          first ? `<p>Filmaffisch – ${p.title}. Tryckt på kraftigt matt papper. Finns i tre storlekar, med eller utan ram.</p>` : "",
          first ? VENDOR : "",
          first ? PRODUCT_TYPE : "",
          first ? ["poster", "film", ...p.tags].join(", ") : "",
          first ? "TRUE" : "",
          first ? "Storlek" : "", size.name,
          first ? "Ram" : "", frame.name,
          sku, "shopify", DEFAULT_STOCK, "deny", "manual",
          (size.price + frame.extra).toFixed(2),
          "TRUE", "TRUE",
          first ? `${base}${p.imageName}` : "",
          first ? 1 : "",
          first ? `Filmaffisch ${p.title}` : "",
          first ? "active" : "",
        ]);
        first = false;
      }
    }
  }

  const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
  const csvPath = path.join(OUT_DIR, "products.csv");
  fs.writeFileSync(csvPath, csv, "utf8");

  console.log(`✔ ${csvPath} skriven: ${products.length} produkter, ${rows.length - 1} varianter\n`);

  // Gruppera filmerna per serie så det är lätt att se vilka paket som blir möjliga
  const bySeries = {};
  for (const p of products) {
    for (const tag of p.tags) (bySeries[tag] ??= []).push(p.title);
  }
  for (const [tag, titles] of Object.entries(bySeries)) {
    const note = titles.length < 2 ? "  (bara en film – blir inget paket)" : "";
    console.log(`  ${tag} (${titles.length})${note}`);
    for (const t of titles) console.log(`     - ${t}`);
  }
}

main();
